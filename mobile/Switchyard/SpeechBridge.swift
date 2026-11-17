import AVFoundation
import Speech

// Owned by one web view. No bridge or microphone survives a host switch.
final class SpeechBridge: NSObject, AVSpeechSynthesizerDelegate {
    var emit: (([String: Any]) -> Void)?
    private let audio = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var listeningID: Int?
    private var tapInstalled = false
    private var generation = 0
    private var spokenIDs: [ObjectIdentifier: Int] = [:]
    private var interruption: NSObjectProtocol?

    override init() {
        super.init()
        speaker.delegate = self
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  type == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.stopAll()
        }
    }

    deinit { if let interruption { NotificationCenter.default.removeObserver(interruption) } }

    func handle(_ body: [String: Any]) {
        guard let op = body["op"] as? String else { return }
        switch op {
        case "listen":
            guard let id = body["id"] as? Int else { return }
            listen(id: id, language: body["lang"] as? String ?? Locale.current.identifier)
        case "stop", "abort":
            guard let id = body["id"] as? Int, id == listeningID else { return }
            if op == "stop" {
                request?.endAudio()
                stopAudio()
                let current = generation
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                    guard let self, self.generation == current else { return }
                    self.endRecognition()
                }
            } else { endRecognition() }
        case "speak":
            guard let id = body["id"] as? Int, let text = body["text"] as? String, text.count <= 10_000 else { return }
            do {
                try prepareAudio()
                let utterance = AVSpeechUtterance(string: text)
                utterance.voice = AVSpeechSynthesisVoice(language: body["lang"] as? String ?? Locale.current.identifier)
                let rate = (body["rate"] as? Double) ?? 1
                utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(min(2, max(0.5, rate)))
                spokenIDs[ObjectIdentifier(utterance)] = id
                speaker.speak(utterance)
            } catch { emit?(["id": id, "type": "speech-error", "error": "audio-busy"]) }
        case "hush":
            spokenIDs.removeAll()
            speaker.stopSpeaking(at: .immediate)
        default: break
        }
    }

    private func prepareAudio() throws {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord || session.mode != .voiceChat {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        }
        try session.setActive(true)
    }

    private func listen(id: Int, language: String) {
        endRecognition()
        listeningID = id
        let current = generation
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self, self.generation == current, self.listeningID == id else { return }
                guard status == .authorized else { self.fail("service-not-allowed"); return }
                AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self, self.generation == current, self.listeningID == id else { return }
                        guard allowed else { self.fail("not-allowed"); return }
                        self.startRecognition(id: id, language: language, generation: current)
                    }
                }
            }
        }
    }

    private func startRecognition(id: Int, language: String, generation current: Int) {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: language))
        guard let recognizer, recognizer.isAvailable else { fail("network"); return }
        do {
            try prepareAudio()
            let input = audio.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { fail("audio-capture"); return }
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            tapInstalled = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, self.generation == current, self.listeningID == id else { return }
                    if let result {
                        self.emit?(["id": id, "type": "result", "text": result.bestTranscription.formattedString, "final": result.isFinal])
                        if result.isFinal { self.endRecognition(); return }
                    }
                    if error != nil { self.fail("no-speech") }
                }
            }
            audio.prepare()
            try audio.start()
        } catch { fail("audio-capture") }
    }

    private func stopAudio() {
        audio.stop()
        if tapInstalled { audio.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }

    private func endRecognition() {
        generation += 1
        stopAudio()
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
        recognizer = nil
        if let id = listeningID {
            listeningID = nil
            emit?(["id": id, "type": "end"])
        }
    }

    private func fail(_ error: String) {
        if let id = listeningID { emit?(["id": id, "type": "error", "error": error]) }
        endRecognition()
    }

    func stopAll() {
        fail("aborted")
        for id in spokenIDs.values { emit?(["id": id, "type": "speech-error", "error": "interrupted"]) }
        spokenIDs.removeAll()
        speaker.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if let id = spokenIDs.removeValue(forKey: ObjectIdentifier(utterance)) { emit?(["id": id, "type": "spoken"]) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        if let id = spokenIDs.removeValue(forKey: ObjectIdentifier(utterance)) { emit?(["id": id, "type": "speech-error", "error": "canceled"]) }
    }
}
