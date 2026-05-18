// swift-tools-version:5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "SwiftHelperRemake",
    platforms: [
        .macOS(.v10_15) // Set a deployment target, e.g., macOS 10.15 or later
    ],
    dependencies: [
        // Dependencies declare other packages that this package depends on.
        // .package(url: /* package url */, from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "ObjCExceptionCatcher",
            dependencies: [],
            publicHeadersPath: "include"
        ),
        .executableTarget(
            name: "SwiftHelperRemake",
            dependencies: ["ObjCExceptionCatcher"],
            path: "Sources/SwiftHelper",
            resources: [
                .embedInCode("Resources/rec-start.mp3"),
                .embedInCode("Resources/rec-stop.mp3")
            ]
        )
    ]
)
