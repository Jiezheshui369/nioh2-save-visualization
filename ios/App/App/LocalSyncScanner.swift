import UIKit
import AVFoundation

// Camera frames stay on-device. Only decoded QR text is returned; no photos are saved.
final class LocalSyncScanner: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let capture = AVCaptureSession()
    private let cameraQueue = DispatchQueue(label: "nioh.local-sync.camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    private let completion: (Result<String, Error>) -> Void

    init(completion: @escaping (Result<String, Error>) -> Void) {
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(completion:)") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let preview = AVCaptureVideoPreviewLayer(session: capture)
        preview.videoGravity = .resizeAspectFill
        self.preview = preview
        view.layer.addSublayer(preview)
        let title = UILabel()
        title.text = "扫描电脑“同步到手机”页面的二维码"
        title.textColor = .white
        title.numberOfLines = 0
        title.textAlignment = .center
        title.backgroundColor = UIColor.black.withAlphaComponent(0.65)
        let cancel = UIButton(type: .system)
        cancel.setTitle("取消扫描", for: .normal)
        cancel.tintColor = .white
        cancel.backgroundColor = .black
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        for child in [title, cancel] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            title.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            title.heightAnchor.constraint(greaterThanOrEqualToConstant: 60),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
            cancel.widthAnchor.constraint(equalToConstant: 160), cancel.heightAnchor.constraint(equalToConstant: 48)
        ])
        cameraQueue.async {
            do {
                guard let camera = AVCaptureDevice.default(for: .video) else { throw LocalSyncPairing.invalid }
                let input = try AVCaptureDeviceInput(device: camera)
                let output = AVCaptureMetadataOutput()
                self.capture.beginConfiguration()
                guard self.capture.canAddInput(input), self.capture.canAddOutput(output) else {
                    self.capture.commitConfiguration()
                    throw LocalSyncPairing.invalid
                }
                self.capture.addInput(input)
                self.capture.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
                self.capture.commitConfiguration()
                self.capture.startRunning()
            } catch { DispatchQueue.main.async { self.finish(.failure(error)) } }
        }
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        cameraQueue.async { self.capture.stopRunning() }
        if !finished { finished = true; completion(.success("")) }
    }
    @objc private func cancelScan() { finish(.success("")) }
    private func finish(_ result: Result<String, Error>) {
        guard !finished else { return }
        finished = true
        cameraQueue.async { self.capture.stopRunning() }
        dismiss(animated: true) { self.completion(result) }
    }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard let value = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        finish(.success(value))
    }
}
