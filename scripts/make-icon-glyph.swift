// Plain Apps original app icons, drawn from CoreGraphics paths only: no SF Symbol, no font, no third-party artwork, no network.
// Same pipeline as print-cost's scripts/make-icon.swift (D91), with a flat solid background instead of a gradient and the
// glyph chosen by --design. One accent colour per icon on a solid background, readable at 60 px, no text.
// Usage: swift scripts/make-icon-glyph.swift --design <intervals|offscan|tillcard|plainweeks|mood|moodarc|cardscan> [--out <app folder>]
//        swift scripts/make-icon-glyph.swift --design offscan --png <file.png>      (only a 1024 PNG, e.g. for a contact sheet)
// Writes assets/images/{icon,favicon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome}.png
// and assets/expo.icon/{icon.json,Assets/glyph.png}. icon.png is 1024 x 1024 without alpha (App Store rule).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

var opts: [String: String] = [:]
var argi = 1
let args = CommandLine.arguments
while argi + 1 < args.count, args[argi].hasPrefix("--") { opts[String(args[argi].dropFirst(2))] = args[argi + 1]; argi += 2 }
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ h: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((h >> 16) & 255) / 255, CGFloat((h >> 8) & 255) / 255, CGFloat(h & 255) / 255, a])!
}
func lum(_ h: UInt32) -> Double {
  func ch(_ v: UInt32) -> Double { let c = Double(v) / 255; return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * ch((h >> 16) & 255) + 0.7152 * ch((h >> 8) & 255) + 0.0722 * ch(h & 255)
}
func contrast(_ a: UInt32, _ b: UInt32) -> Double { let x = lum(a), y = lum(b); return (max(x, y) + 0.05) / (min(x, y) + 0.05) }
func mix(_ a: UInt32, _ b: UInt32, _ t: Double) -> UInt32 {
  func c(_ s: Int) -> UInt32 { let x = Double((a >> s) & 255), y = Double((b >> s) & 255); return UInt32((x + (y - x) * t).rounded()) }
  return (c(16) << 16) | (c(8) << 8) | c(0)
}

struct Design { let name: String; let bg: UInt32; let accent: UInt32; let note: String }
let designs: [String: Design] = [
  "intervals": Design(name: "intervals", bg: 0xB43308, accent: 0xFFE082, note: "segmented ring, one segment lit"),
  "offscan": Design(name: "offscan", bg: 0x0D47A1, accent: 0x69F0AE, note: "page with a scan line"),
  "tillcard": Design(name: "tillcard", bg: 0x5E35B1, accent: 0xB2FF59, note: "stacked cards, three-bar mark"),
  "plainweeks": Design(name: "plainweeks", bg: 0x1F6F68, accent: 0xFFE9A8, note: "crescent with a leaf"),
  "mood": Design(name: "mood", bg: 0xAD1457, accent: 0xFFEB3B, note: "one calm face"),
  "moodarc": Design(name: "moodarc", bg: 0xB5306F, accent: 0xFFFFFF, note: "seven dots on a rising arc, the sixth a ring (today)"),
  "cardscan": Design(name: "cardscan", bg: 0x263238, accent: 0x4DD0E1, note: "card inside corner frame"),
]
guard let dname = opts["design"], let design = designs[dname] else { fail("--design must be one of \(designs.keys.sorted().joined(separator: ", "))") }
let white: UInt32 = 0xFFFFFF
print(String(format: "design %@: bg #%06X, white on bg %.2f:1, accent on bg %.2f:1", dname, design.bg, contrast(white, design.bg), contrast(design.accent, design.bg)))

/// Square canvas with a top-left origin. `opaque` = no alpha channel.
func canvas(_ size: Int, opaque: Bool = false) -> CGContext {
  let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info)!
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: 1, y: -1)
  return ctx
}
func save(_ image: CGImage, _ url: URL) {
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { fail("could not write \(url.path)") }
  print("wrote \(url.path)")
}
func resized(_ image: CGImage, to size: Int, opaque: Bool = false) -> CGImage {
  let out = canvas(size, opaque: opaque)
  out.interpolationQuality = .high
  out.translateBy(x: 0, y: CGFloat(size))
  out.scaleBy(x: 1, y: -1)
  out.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  return out.makeImage()!
}

// ---------- path helpers (design space 1000 x 1000, y down) ----------
func roundedPolygon(_ pts: [CGPoint], _ r: CGFloat) -> CGPath {
  let p = CGMutablePath()
  let n = pts.count
  p.move(to: CGPoint(x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2))
  for k in 1...n { p.addArc(tangent1End: pts[k % n], tangent2End: pts[(k + 1) % n], radius: r) }
  p.closeSubpath()
  return p
}
func rrect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> CGPath {
  CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil)
}
/// Annular sector from angle a0 to a1 (degrees, 0 = up, clockwise), sampled as a polygon (no arc-direction ambiguity).
func sector(_ c: CGPoint, _ r0: CGFloat, _ r1: CGFloat, _ a0: Double, _ a1: Double) -> CGPath {
  let p = CGMutablePath()
  func pt(_ r: CGFloat, _ a: Double) -> CGPoint { CGPoint(x: c.x + r * CGFloat(sin(a * .pi / 180)), y: c.y - r * CGFloat(cos(a * .pi / 180))) }
  let steps = max(2, Int((a1 - a0) / 1.5))
  p.move(to: pt(r1, a0))
  for s in 1...steps { p.addLine(to: pt(r1, a0 + (a1 - a0) * Double(s) / Double(steps))) }
  for s in 0...steps { p.addLine(to: pt(r0, a1 - (a1 - a0) * Double(s) / Double(steps))) }
  p.closeSubpath()
  return p
}
/// Fills a path with rounded corners by also stroking it with a round join (path was built `k` smaller on each side).
func fillRounded(_ ctx: CGContext, _ path: CGPath, _ k: CGFloat, _ colour: CGColor) {
  ctx.saveGState()
  ctx.addPath(path)
  ctx.setFillColor(colour)
  ctx.setStrokeColor(colour)
  ctx.setLineWidth(k * 2)
  ctx.setLineJoin(.round)
  ctx.drawPath(using: .fillStroke)
  ctx.restoreGState()
}
func clear(_ ctx: CGContext, _ path: CGPath) {
  ctx.saveGState()
  ctx.setBlendMode(.clear)
  ctx.addPath(path)
  ctx.fillPath()
  ctx.restoreGState()
}
/// Punches a gap of `halo` around `path` (a stroked outline), so overlapping shapes read as separate layers.
func clearHalo(_ ctx: CGContext, _ path: CGPath, _ halo: CGFloat) {
  ctx.saveGState()
  ctx.setBlendMode(.clear)
  ctx.setLineWidth(halo * 2)
  ctx.setLineJoin(.round)
  ctx.addPath(path)
  ctx.setStrokeColor(rgb(0))
  ctx.strokePath()
  ctx.addPath(path)
  ctx.fillPath()
  ctx.restoreGState()
}

enum Look { case colour, mono }

func drawGlyph(_ ctx: CGContext, box: CGRect, _ look: Look) {
  ctx.saveGState()
  ctx.translateBy(x: box.minX, y: box.minY)
  ctx.scaleBy(x: box.width / 1000, y: box.height / 1000)
  let main = rgb(white)
  let acc = look == .colour ? rgb(design.accent) : rgb(white)
  switch design.name {
  case "intervals":
    // Eight segments of a ring (a round of work); the one at the top right, the current interval, is thicker and lit.
    let c = CGPoint(x: 500, y: 500)
    let k: CGFloat = 14
    for i in 0..<8 {
      let a0 = Double(i) * 45 + 3.5, a1 = Double(i + 1) * 45 - 3.5
      let lit = i == 0
      let path = lit ? sector(c, 205 + k, 395 - k, a0 + 1, a1 - 1) : sector(c, 245 + k, 365 - k, a0 + 2, a1 - 2)
      fillRounded(ctx, path, k, lit ? acc : main)
    }
  case "offscan":
    // A page with a cut corner and a fold, and a scan line crossing it (it sticks out on both sides).
    let page = roundedPolygon([CGPoint(x: 270, y: 130), CGPoint(x: 560, y: 130), CGPoint(x: 730, y: 300), CGPoint(x: 730, y: 870), CGPoint(x: 270, y: 870)], 34)
    ctx.addPath(page)
    ctx.setFillColor(main)
    ctx.fillPath()
    if look == .colour {
      let fold = roundedPolygon([CGPoint(x: 560, y: 130), CGPoint(x: 730, y: 300), CGPoint(x: 560, y: 300)], 10)
      ctx.addPath(fold)
      ctx.setFillColor(rgb(mix(white, design.bg, 0.55)))
      ctx.fillPath()
    }
    let bar = rrect(150, 500, 700, 56, 28)
    clearHalo(ctx, bar, 24)
    ctx.addPath(bar)
    ctx.setFillColor(acc)
    ctx.fillPath()
  case "tillcard":
    // Two stacked cards; the front one carries a three-bar mark (punched through).
    ctx.saveGState()
    ctx.translateBy(x: 560, y: 405)
    ctx.rotate(by: -0.17)
    ctx.addPath(rrect(-320, -200, 640, 400, 56))
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.restoreGState()
    let front = rrect(140, 425, 640, 410, 56)
    clearHalo(ctx, front, 26)
    ctx.addPath(front)
    ctx.setFillColor(main)
    ctx.fillPath()
    for (x, w) in [(300.0, 52.0), (404.0, 112.0), (568.0, 52.0)] { clear(ctx, rrect(CGFloat(x), 515, CGFloat(w), 230, 14)) }
  case "plainweeks":
    // A crescent, with a leaf growing in its opening. Nothing that says pregnancy.
    let outer = CGPath(ellipseIn: CGRect(x: 160, y: 200, width: 680, height: 680), transform: nil)
    let inner = CGPath(ellipseIn: CGRect(x: 290, y: 130, width: 600, height: 600), transform: nil)
    ctx.addPath(outer)
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, inner)
    let leaf = CGMutablePath()
    let base = CGPoint(x: 520, y: 640), tip = CGPoint(x: 740, y: 290)
    leaf.move(to: base)
    leaf.addQuadCurve(to: tip, control: CGPoint(x: 460, y: 380))
    leaf.addQuadCurve(to: base, control: CGPoint(x: 780, y: 580))
    leaf.closeSubpath()
    ctx.addPath(leaf)
    ctx.setFillColor(acc)
    ctx.fillPath()
  case "mood":
    // One calm face (the app's home asks "How are you?"): a lit disc, two eyes and a smile punched through.
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 140, y: 140, width: 720, height: 720), transform: nil))
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 322, y: 360, width: 92, height: 124), transform: nil))
    clear(ctx, CGPath(ellipseIn: CGRect(x: 586, y: 360, width: 92, height: 124), transform: nil))
    let smile = CGMutablePath()
    for s in 0...40 {
      let a = (30.0 + 120.0 * Double(s) / 40) * .pi / 180
      let p = CGPoint(x: 500 + 215 * CGFloat(cos(a)), y: 470 + 215 * CGFloat(sin(a)))
      if s == 0 { smile.move(to: p) } else { smile.addLine(to: p) }
    }
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(smile)
    ctx.setLineWidth(62)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
  case "moodarc":
    // Identity sheet 13 (Mood Days): seven dots on a gentle upward arc that grow slightly; the sixth is a ring (today).
    // Sketch coordinates are the sheet's 64-unit SVG, scaled by 15.625.
    // Radii and ring size are the sheet's; spacing is recomputed so no two shapes touch (the sketch's dots overlapped).
    ctx.saveGState()
    ctx.translateBy(x: 500, y: 520) // fit the arc inside the safe area and centre it
    ctx.scaleBy(x: 0.84, y: 0.84)
    ctx.translateBy(x: -500, y: -575)
    let k: CGFloat = 1000.0 / 64.0
    let radii: [Double] = [2.8, 3.1, 3.4, 3.7, 4.0, 5.3, 4.2] // index 5 is the ring (today), drawn as an outline
    var xs: [Double] = [0]
    for i in 1..<radii.count { xs.append(xs[i - 1] + radii[i - 1] + radii[i] + (i == 5 || i == 6 ? 2.6 : 2.2) + (i == 5 ? 0.9 : 0)) }
    let span = xs.last!
    let x0 = 32 - span / 2
    for i in 0..<radii.count {
      let t = xs[i] / span
      let cx = CGFloat(x0 + xs[i]) * k
      let cy = CGFloat(43.5 - 13.5 * (1 - (1 - t) * (1 - t))) * k
      let r = CGFloat(radii[i]) * k
      if i == 5 {
        ctx.addPath(CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2), transform: nil))
        ctx.setStrokeColor(acc)
        ctx.setLineWidth(2.5 * k)
        ctx.strokePath()
      } else {
        ctx.addPath(CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2), transform: nil))
        ctx.setFillColor(acc)
        ctx.fillPath()
      }
    }
    ctx.restoreGState()
  case "cardscan":
    // A card inside four scanner corners.
    let card = rrect(240, 350, 520, 330, 44)
    ctx.addPath(card)
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, rrect(296, 410, 86, 66, 14))
    clear(ctx, rrect(296, 560, 280, 36, 18))
    let l: CGFloat = 170, t: CGFloat = 54
    let x0: CGFloat = 130, x1: CGFloat = 870, y0: CGFloat = 215, y1: CGFloat = 815
    let corner = CGMutablePath()
    corner.move(to: CGPoint(x: x0, y: y0 + l)); corner.addLine(to: CGPoint(x: x0, y: y0)); corner.addLine(to: CGPoint(x: x0 + l, y: y0))
    corner.move(to: CGPoint(x: x1 - l, y: y0)); corner.addLine(to: CGPoint(x: x1, y: y0)); corner.addLine(to: CGPoint(x: x1, y: y0 + l))
    corner.move(to: CGPoint(x: x1, y: y1 - l)); corner.addLine(to: CGPoint(x: x1, y: y1)); corner.addLine(to: CGPoint(x: x1 - l, y: y1))
    corner.move(to: CGPoint(x: x0 + l, y: y1)); corner.addLine(to: CGPoint(x: x0, y: y1)); corner.addLine(to: CGPoint(x: x0, y: y1 - l))
    ctx.addPath(corner)
    ctx.setStrokeColor(acc)
    ctx.setLineWidth(t)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
  default: fail("unknown design")
  }
  ctx.restoreGState()
}

func glyphLayer(_ size: Int, fraction: CGFloat, _ look: Look) -> CGContext {
  let ctx = canvas(size)
  let s = CGFloat(size), box = s * fraction
  drawGlyph(ctx, box: CGRect(x: (s - box) / 2, y: (s - box) / 2, width: box, height: box), look)
  return ctx
}
func solid(_ size: Int) -> CGImage {
  let c = canvas(size, opaque: true)
  c.setFillColor(rgb(design.bg))
  c.fill(CGRect(x: 0, y: 0, width: size, height: size))
  return c.makeImage()!
}
let storeIcon: CGImage = {
  let ctx = canvas(1024, opaque: true)
  ctx.setFillColor(rgb(design.bg))
  ctx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  let layer = glyphLayer(1024, fraction: 0.9, .colour).makeImage()!
  ctx.translateBy(x: 0, y: 1024)
  ctx.scaleBy(x: 1, y: -1)
  ctx.draw(layer, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
  return ctx.makeImage()!
}()

if let png = opts["png"] {
  save(storeIcon, URL(fileURLWithPath: png))
  exit(0)
}

let root = URL(fileURLWithPath: opts["out"] ?? FileManager.default.currentDirectoryPath)
let images = root.appendingPathComponent("assets/images")
let bundle = root.appendingPathComponent("assets/expo.icon")
let iconAssets = bundle.appendingPathComponent("Assets")
for dir in [images, iconAssets] { try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }

save(storeIcon, images.appendingPathComponent("icon.png"))
save(resized(storeIcon, to: 48, opaque: true), images.appendingPathComponent("favicon.png"))
// Android adaptive layers: 108 dp canvas, 66 % safe zone; the drawing covers about 80 % of its box, so a 0.78 box keeps it inside.
save(glyphLayer(1024, fraction: 0.74, .colour).makeImage()!, images.appendingPathComponent("android-icon-foreground.png"))
save(solid(1024), images.appendingPathComponent("android-icon-background.png"))
save(glyphLayer(1024, fraction: 0.74, .mono).makeImage()!, images.appendingPathComponent("android-icon-monochrome.png"))
// Splash: the glyph alone on transparent; the splash background colour in app.config.ts is the icon colour.
save(glyphLayer(1024, fraction: 0.9, .colour).makeImage()!, images.appendingPathComponent("splash-icon.png"))
// iOS 26 Icon Composer bundle (app.config.ts ios.icon): the transparent glyph layer over a solid fill.
save(glyphLayer(1024, fraction: 0.9, .colour).makeImage()!, iconAssets.appendingPathComponent("glyph.png"))
let r = String(format: "%.5f", Double((design.bg >> 16) & 255) / 255)
let g = String(format: "%.5f", Double((design.bg >> 8) & 255) / 255)
let b = String(format: "%.5f", Double(design.bg & 255) / 255)
// Dark appearance: the motif keeps its colours on the app's dark background token (moodarc only; the others keep one fill).
let darkFill = design.name == "moodarc" ? """

  "fill-specializations" : [
    { "value" : "automatic" },
    { "appearance" : "dark", "value" : { "solid" : "srgb:0.15294,0.11765,0.11765,1.00000" } }
  ],
""" : ""
let json = """
{
  "fill" : {
    "solid" : "extended-srgb:\(r),\(g),\(b),1.00000"
  },\(darkFill)
  "groups" : [
    {
      "layers" : [
        {
          "image-name" : "glyph.png",
          "name" : "glyph"
        }
      ],
      "shadow" : {
        "kind" : "neutral",
        "opacity" : 0.5
      },
      "translucency" : {
        "enabled" : true,
        "value" : 0.5
      }
    }
  ],
  "supported-platforms" : {
    "circles" : [
      "watchOS"
    ],
    "squares" : "shared"
  }
}

"""
try json.write(to: bundle.appendingPathComponent("icon.json"), atomically: true, encoding: .utf8)
print("wrote assets/expo.icon/icon.json")
