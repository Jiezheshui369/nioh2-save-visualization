import Foundation
import Capacitor
import AVFoundation

@objc(LocalSyncPlugin)
public final class LocalSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalSyncPlugin"
    public let jsName = "LocalSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "receive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]
    private var connection: LocalSyncConnection?
    private var scanning = false

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let pairing = try LocalSyncKeychain.load()
                call.resolve(["paired": pairing != nil, "host": pairing?.host ?? ""])
            } catch { call.reject("手机配对信息不可用，请解锁设备后重新配对。") }
        }
    }
    @objc func forget(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.connection == nil else { call.reject("请等待当前同步结束后断开配对。"); return }
            do { try LocalSyncKeychain.forget(); call.resolve() }
            catch { call.reject("清除配对失败，请解锁设备后重试。") }
        }
    }
    @objc func receive(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.connection == nil else { call.reject("正在同步，请稍后重试。"); return }
            do {
                let qr = call.getString("qr") ?? ""
                let endpoint: LocalSyncPairing
                if qr.isEmpty {
                    guard let saved = try LocalSyncKeychain.load() else { throw LocalSyncPairing.invalid }
                    endpoint = saved
                } else { endpoint = try LocalSyncPairing.parse(qr) }
                let connection = LocalSyncConnection(endpoint: endpoint, pairing: !qr.isEmpty) { result in
                    self.connection = nil
                    switch result {
                    case .success(let value): call.resolve(value)
                    case .failure(let error): call.reject(error.localizedDescription)
                    }
                }
                self.connection = connection
                connection.start()
            } catch { call.reject("配对信息无效，请重新扫描电脑二维码。") }
        }
    }
    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.scanning else { call.reject("相机已打开。"); return }
            self.scanning = true
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    guard granted, let presenter = self.bridge?.viewController,
                          presenter.presentedViewController == nil else {
                        self.scanning = false
                        call.reject("无法打开相机。请允许相机权限，或手动输入配对信息。")
                        return
                    }
                    let scanner = LocalSyncScanner { result in
                        self.scanning = false
                        switch result {
                        case .success(let value): call.resolve(["value": value])
                        case .failure: call.reject("相机不可用，请手动输入配对信息。")
                        }
                    }
                    scanner.modalPresentationStyle = .fullScreen
                    presenter.present(scanner, animated: true)
                }
            }
        }
    }
}

final class NiohBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalSyncPlugin())
    }
}
