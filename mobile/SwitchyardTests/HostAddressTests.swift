import XCTest
@testable import Switchyard

final class HostAddressTests: XCTestCase {
    func testOriginValidation() {
        XCTAssertEqual(HostAddress.parse(" https://yard.test:8443/ ")?.absoluteString, "https://yard.test:8443")
        for value in ["http://yard.test", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://user:pass@yard.test", "https://yard.test/path", "https://yard.test?token=x"] {
            XCTAssertNil(HostAddress.parse(value), value)
        }
    }

    func testDeepLinkDoesNotPermitAnArbitraryScheme() {
        XCTAssertEqual(HostAddress.fromLink(URL(string: "switchyard://connect?host=https%3A%2F%2Fyard.test")!)?.host, "yard.test")
        XCTAssertNil(HostAddress.fromLink(URL(string: "switchyard://connect?host=http%3A%2F%2Fyard.test")!))
        XCTAssertNil(HostAddress.fromLink(URL(string: "other://connect?host=https%3A%2F%2Fyard.test")!))
    }

    func testBridgeOriginIncludesThePort() {
        let host = URL(string: "https://yard.test")!
        XCTAssertTrue(HostAddress.sameOrigin(host, URL(string: "https://yard.test:443/path")!))
        XCTAssertFalse(HostAddress.sameOrigin(host, URL(string: "https://yard.test:444/path")!))
        XCTAssertFalse(HostAddress.sameOrigin(host, URL(string: "https://other.test")!))
    }
}
