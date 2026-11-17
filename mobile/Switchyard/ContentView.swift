import SwiftUI

@MainActor
final class Connection: ObservableObject {
    @Published var host: URL?
    @Published var error: String?
    @Published var connecting = false
    @Published var showHosts = false
    @Published var recent = UserDefaults.standard.stringArray(forKey: "hosts") ?? []
    private var attempt: Task<Void, Never>?

    init() {
        if let saved = UserDefaults.standard.string(forKey: "selectedHost"), let url = HostAddress.parse(saved) {
            connect(url)
        } else { showHosts = true }
    }

    func connect(_ url: URL) {
        attempt?.cancel()
        host = nil
        error = nil
        connecting = true
        attempt = Task {
            do {
                var request = URLRequest(url: url.appendingPathComponent("health"))
                request.timeoutInterval = 15
                request.cachePolicy = .reloadIgnoringLocalCacheData
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let finalURL = response.url, HostAddress.sameOrigin(url, finalURL),
                      String(data: data, encoding: .utf8)?.hasPrefix("yardd ") == true else {
                    throw URLError(.badServerResponse)
                }
                try Task.checkCancellation()
                host = url
                showHosts = false
                try await Task.sleep(nanoseconds: 25_000_000_000)
                if connecting { failed("The host opened, but sessions did not connect. Check that its HTTPS origin is allowed and WebSockets pass through your proxy.") }
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled { failed("Could not connect. Check the address, your private network or Tailscale connection, and that Switchyard is running.") }
            }
        }
    }

    func connected() {
        guard let host else { return }
        attempt?.cancel()
        connecting = false
        recent = [host.absoluteString] + recent.filter { $0 != host.absoluteString }
        recent = Array(recent.prefix(8))
        UserDefaults.standard.set(recent, forKey: "hosts")
        UserDefaults.standard.set(host.absoluteString, forKey: "selectedHost")
    }

    func failed(_ message: String) {
        connecting = false
        error = message
        showHosts = true
    }
}

struct ContentView: View {
    @StateObject private var connection = Connection()
    @Environment(\.scenePhase) private var phase
    @State private var address = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(connection.host?.host ?? "Switchyard").font(.caption).lineLimit(1)
                Spacer()
                if connection.connecting { ProgressView().controlSize(.small) }
                Button { connection.showHosts = true } label: { Image(systemName: "server.rack") }
                    .accessibilityLabel("Switch host")
                    .frame(minWidth: 44, minHeight: 44)
            }.padding(.horizontal).background(Color(uiColor: .systemGroupedBackground))
            if let host = connection.host {
                HostWebView(host: host, connection: connection, active: phase == .active).id(host)
            } else {
                Spacer()
                Text("Your sessions, wherever you are.").foregroundStyle(.secondary)
                Spacer()
                Button("Connect a host") { connection.showHosts = true }.padding()
            }
        }
        .sheet(isPresented: $connection.showHosts) {
            NavigationStack {
                Form {
                    Section {
                        Text("Connect to your Switchyard host over HTTPS. Your phone needs access to the same private network, such as Tailscale.")
                        TextField("https://your-host.ts.net", text: $address)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityLabel("Host address")
                        Button(connection.connecting ? "Connecting…" : "Connect") {
                            guard let url = HostAddress.parse(address) else {
                                connection.error = "Enter an HTTPS host address without a path, login or localhost."
                                return
                            }
                            connection.connect(url)
                        }.disabled(connection.connecting)
                    } header: { Text("Switchyard for iPhone · TestFlight") }
                    if let error = connection.error { Section { Text(error).foregroundStyle(.red) } }
                    if !connection.recent.isEmpty {
                        Section("Recent hosts") {
                            ForEach(connection.recent, id: \.self) { value in
                                Button(value) {
                                    address = value
                                    if let url = HostAddress.parse(value) { connection.connect(url) }
                                }
                            }.onDelete { indices in
                                connection.recent.remove(atOffsets: indices)
                                UserDefaults.standard.set(connection.recent, forKey: "hosts")
                            }
                        }
                    }
                    Section { Text("Sessions keep running on the host while the app is closed. Voice stops when the app goes into the background.").foregroundStyle(.secondary) }
                }
                .navigationTitle("Connect a host")
                .toolbar { if connection.host != nil { Button("Done") { connection.showHosts = false } } }
            }
        }
        .onOpenURL { url in
            if let host = HostAddress.fromLink(url) {
                address = host.absoluteString
                // A link fills the address; connecting remains an explicit choice on the phone.
                connection.showHosts = true
            }
        }
    }
}
