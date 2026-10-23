import AVFoundation
import CoreImage
import CoreVideo
import Foundation
import ImageIO

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let frames = root.appendingPathComponent("demo/frames")
let audio = root.appendingPathComponent("demo/audio")
let output = root.appendingPathComponent("demo/HuddleLens-Demo-1080p.mp4")
let silent = root.appendingPathComponent("demo/.huddlelens-silent.mp4")
let imageNames = [
  "01-home", "02-live", "03-ai-lens", "04-telestration", "05-coach-detail",
  "06-move-break", "08-challenge-progress", "09-challenge-complete",
  "10-accessibility", "11-calm-commentary"
]

func loadImage(_ url: URL) -> CIImage {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Could not load image at \(url.path)")
  }
  return CIImage(cgImage: image)
}

let audioAssets = (1...10).map { index in
  AVURLAsset(url: audio.appendingPathComponent(String(format: "%02d.aiff", index)))
}
let durations = audioAssets.map { CMTimeGetSeconds($0.duration) }
let totalDuration = durations.reduce(0, +)
let images = imageNames.map { loadImage(frames.appendingPathComponent("\($0).png")) }
let closingImage = loadImage(frames.appendingPathComponent("12-close.png"))

try? FileManager.default.removeItem(at: silent)
try? FileManager.default.removeItem(at: output)

let writer = try AVAssetWriter(outputURL: silent, fileType: .mp4)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: 1920,
  AVVideoHeightKey: 1080,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 12_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoMaxKeyFrameIntervalKey: 60
  ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attributes: [String: Any] = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: 1920,
  kCVPixelBufferHeightKey as String: 1080,
  kCVPixelBufferIOSurfacePropertiesKey as String: [:]
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
guard writer.canAdd(input) else { fatalError("Cannot add video input") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Writer failed") }
writer.startSession(atSourceTime: .zero)

let context = CIContext(options: [.useSoftwareRenderer: false])
let colorSpace = CGColorSpaceCreateDeviceRGB()
let fps: Int32 = 30
let frameCount = Int(ceil(totalDuration * Double(fps)))
var cumulative: [Double] = [0]
for duration in durations { cumulative.append(cumulative.last! + duration) }

func sceneIndex(at seconds: Double) -> Int {
  for index in 0..<durations.count where seconds < cumulative[index + 1] { return index }
  return durations.count - 1
}

for frame in 0..<frameCount {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  let seconds = Double(frame) / Double(fps)
  let scene = sceneIndex(at: seconds)
  let local = seconds - cumulative[scene]
  let progress = min(1, max(0, local / durations[scene]))
  var current = images[scene]
  if scene == images.count - 1 && progress > 0.72 {
    let amount = min(1, (progress - 0.72) / 0.12)
    current = current.applyingFilter("CIDissolveTransition", parameters: [
      kCIInputTargetImageKey: closingImage,
      kCIInputTimeKey: amount
    ])
  }

  let zoom = CGFloat(1.0 + 0.012 * progress)
  let x = CGFloat(1920) * (1 - zoom) / 2
  let y = CGFloat(1080) * (1 - zoom) / 2
  current = current.transformed(by: CGAffineTransform(translationX: x, y: y).scaledBy(x: zoom, y: zoom))

  if scene > 0 && local < 0.65 {
    let previous = images[scene - 1]
    current = previous.applyingFilter("CIDissolveTransition", parameters: [
      kCIInputTargetImageKey: current,
      kCIInputTimeKey: local / 0.65
    ])
  }

  let fadeIn = min(1, seconds / 0.8)
  let fadeOut = min(1, max(0, (totalDuration - seconds) / 1.2))
  current = current.applyingFilter("CIColorMatrix", parameters: [
    "inputRVector": CIVector(x: fadeIn * fadeOut, y: 0, z: 0, w: 0),
    "inputGVector": CIVector(x: 0, y: fadeIn * fadeOut, z: 0, w: 0),
    "inputBVector": CIVector(x: 0, y: 0, z: fadeIn * fadeOut, w: 0),
    "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1)
  ])

  var buffer: CVPixelBuffer?
  guard let pool = adaptor.pixelBufferPool,
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
        let pixelBuffer = buffer else { fatalError("Could not allocate pixel buffer") }
  context.render(current, to: pixelBuffer, bounds: CGRect(x: 0, y: 0, width: 1920, height: 1080), colorSpace: colorSpace)
  adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps))
}

input.markAsFinished()
let writerGroup = DispatchGroup()
writerGroup.enter()
writer.finishWriting { writerGroup.leave() }
writerGroup.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Video render failed") }

let composition = AVMutableComposition()
let silentAsset = AVURLAsset(url: silent)
guard let sourceVideo = silentAsset.tracks(withMediaType: .video).first,
      let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
  fatalError("Could not create composition video track")
}
try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: silentAsset.duration), of: sourceVideo, at: .zero)

guard let narrationTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
  fatalError("Could not create narration track")
}
var cursor = CMTime.zero
for asset in audioAssets {
  guard let sourceAudio = asset.tracks(withMediaType: .audio).first else { fatalError("Missing narration audio") }
  try narrationTrack.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: sourceAudio, at: cursor)
  cursor = CMTimeAdd(cursor, asset.duration)
}

guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
  fatalError("Could not create exporter")
}
exporter.outputURL = output
exporter.outputFileType = .mp4
exporter.shouldOptimizeForNetworkUse = true
let exportGroup = DispatchGroup()
exportGroup.enter()
exporter.exportAsynchronously { exportGroup.leave() }
exportGroup.wait()
guard exporter.status == .completed else { fatalError(exporter.error?.localizedDescription ?? "Export failed") }
try? FileManager.default.removeItem(at: silent)
print("Rendered \(output.path) — \(String(format: "%.1f", totalDuration)) seconds")
