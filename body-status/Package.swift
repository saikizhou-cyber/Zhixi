// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BodyStatusCore",
    products: [.library(name: "BodyStatusCore", targets: ["BodyStatusCore"])],
    targets: [
        .target(name: "BodyStatusCore", path: "BodyStatusCore"),
        .testTarget(name: "BodyStatusCoreTests", dependencies: ["BodyStatusCore"], path: "Tests/BodyStatusCoreTests")
    ]
)
