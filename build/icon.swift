import AppKit
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor { NSColor(calibratedRed: r/255, green: g/255, blue: b/255, alpha: 1) }
let background = NSBezierPath(roundedRect: NSRect(x: 40.96, y: 40.96, width: 942.08, height: 942.08), xRadius: 215.04, yRadius: 215.04)
NSGradient(starting: color(16,36,61), ending: color(32,63,100))!.draw(in: background, angle: 110)
color(216,182,118).setFill()
NSBezierPath(ovalIn: NSRect(x: 69*10.24, y: 70*10.24, width: 10*10.24, height: 10*10.24)).fill()
func stroke(_ points: [(CGFloat, CGFloat)], _ tint: NSColor, _ width: CGFloat = 2.6, closed: Bool = false) {
 let path = NSBezierPath(); path.lineWidth = width*10.24; path.lineCapStyle = .round; path.lineJoinStyle = .round
 for (index, p) in points.enumerated() { let point = NSPoint(x: p.0*10.24, y: (100-p.1)*10.24); if index == 0 { path.move(to: point) } else { path.line(to: point) } }
 if closed { path.close() }; tint.setStroke(); path.stroke()
}
let white = color(244,246,249), gold = color(216,182,118), water = color(106,157,171)
stroke([(16,54),(84,54),(70,75),(30,75)], gold, closed: true)
stroke([(34,54),(50,26),(66,54),(50,75)], white, closed: true)
stroke([(50,26),(50,75)], white)
stroke([(16,54),(84,54)], white)
stroke([(30,83),(59,83)], water, 2)
stroke([(65,83),(70,83)], water, 2)
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
