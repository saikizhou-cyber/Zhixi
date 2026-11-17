"""Check Xcode project references and metadata without Xcode (not a Swift compiler)."""
from pathlib import Path
import plistlib
import re
import xml.etree.ElementTree as ET


def parse_project(text):
    text = re.sub(r"^//[^\n]*", "", text)
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,]+', text)
    index = 0

    def take(expected=None):
        nonlocal index
        if index >= len(tokens):
            raise ValueError("Unexpected end of project")
        token = tokens[index]
        index += 1
        if expected is not None and token != expected:
            raise ValueError(f"Expected {expected}, found {token}")
        return token

    def value():
        token = take()
        if token == "{":
            result = {}
            while index < len(tokens) and tokens[index] != "}":
                key = value()
                if not isinstance(key, str) or key in result:
                    raise ValueError("Invalid or duplicate dictionary key")
                take("=")
                result[key] = value()
                take(";")
            take("}")
            return result
        if token == "(":
            result = []
            while index < len(tokens) and tokens[index] != ")":
                result.append(value())
                take(",")
            take(")")
            return result
        if token.startswith('"'):
            return re.sub(r'\\(["\\])', r'\1', token[1:-1])
        if token.isdigit():
            return int(token)
        if token in "{}()=;,":
            raise ValueError(f"Unexpected token {token}")
        return token

    result = value()
    if index != len(tokens):
        raise ValueError("Trailing project data")
    return result


def check(root):
    project = parse_project((root / "BodyStatus.xcodeproj/project.pbxproj").read_text(encoding="utf-8"))
    objects = project["objects"]
    assert objects[project["rootObject"]]["isa"] == "PBXProject"

    def check_references(node):
        if isinstance(node, dict):
            for child in node.values():
                check_references(child)
        elif isinstance(node, list):
            for child in node:
                check_references(child)
        elif isinstance(node, str) and re.fullmatch(r"[A-F0-9]{24}", node):
            assert node in objects, f"Missing object: {node}"

    check_references(project)
    files = []
    for obj in objects.values():
        if obj["isa"] == "PBXFileReference" and obj.get("sourceTree") == "<group>":
            file = (root / obj["path"]).resolve()
            assert file.is_relative_to(root), f"File outside project: {file}"
            assert file.is_file(), f"Missing file: {file}"
            files.append(file)
        if obj["isa"] == "XCBuildConfiguration":
            for field in ["INFOPLIST_FILE", "CODE_SIGN_ENTITLEMENTS"]:
                if field in obj["buildSettings"]:
                    assert (root / obj["buildSettings"][field]).is_file()

    targets = {key: obj for key, obj in objects.items() if obj["isa"] == "PBXNativeTarget"}
    assert {t["name"] for t in targets.values()} == {"BodyStatus", "BodyStatusWatch"}
    for target in targets.values():
        source_phases = [objects[p] for p in target["buildPhases"] if objects[p]["isa"] == "PBXSourcesBuildPhase"]
        assert len(source_phases) == 1
        sources = [(root / objects[objects[f]["fileRef"]]["path"]).read_text(encoding="utf-8") for f in source_phases[0]["files"]]
        assert sum(len(re.findall(r"@main\b", s)) for s in sources) == 1, target["name"]
        assert any("enum BodyAnalysis" in s for s in sources)
        if target["name"] == "BodyStatusWatch":
            assert not any("import HealthKit" in s for s in sources)

    phone = next(t for t in targets.values() if t["name"] == "BodyStatus")
    watch_id = next(key for key, t in targets.items() if t["name"] == "BodyStatusWatch")
    assert any(objects[d]["target"] == watch_id for d in phone["dependencies"])
    assert any(objects[p]["isa"] == "PBXCopyFilesBuildPhase" and objects[p]["name"] == "Embed Watch Content" for p in phone["buildPhases"])
    resources = [objects[p] for p in phone["buildPhases"] if objects[p]["isa"] == "PBXResourcesBuildPhase"]
    assert len(resources) == 1
    bundled = [objects[objects[f]["fileRef"]]["path"] for f in resources[0]["files"]]
    assert len({Path(p).name for p in bundled}) == len(bundled), "Bundle filenames must be unique"
    web_view = (root / "iOS/HealthWebView.swift").read_text(encoding="utf-8")
    asset_paths = re.findall(r'"(/[^"\n]+)": "(?:text/|font/|image/|application/)', web_view)
    assert asset_paths, "Native resource allowlist is missing"
    assert set(bundled) == {"web" + p for p in asset_paths} | {"web/assets/fonts/Saira-OFL.txt", "iOS/PrivacyInfo.xcprivacy"}
    # 校验真实 import 图，避免包内首屏正常却在切换页面或离线时丢模块。
    for path in bundled:
        if path.endswith(".mjs"):
            source = (root / path).read_text(encoding="utf-8")
            for dependency in re.findall(r'''(?:from\s+|import\s*\()\s*['"](\./[^'"]+)['"]''', source):
                resolved = ((root / path).parent / dependency).resolve().relative_to(root).as_posix()
                assert resolved in bundled, f"Unbundled import: {path} -> {dependency}"
    assert 'NativeDashboardView()' in (root / "iOS/BodyStatusApp.swift").read_text(encoding="utf-8")
    for path in (root / "BodyStatus.xcodeproj/xcshareddata/xcschemes").glob("*.xcscheme"):
        for reference in ET.parse(path).iter("BuildableReference"):
            assert reference.attrib["BlueprintIdentifier"] in targets

    phone_info = plistlib.loads((root / "iOS/Info.plist").read_bytes())
    watch_info = plistlib.loads((root / "Watch/Info.plist").read_bytes())
    entitlements = plistlib.loads((root / "iOS/BodyStatus.entitlements").read_bytes())
    assert phone_info["NSHealthShareUsageDescription"]
    assert watch_info["WKApplication"] is True
    assert watch_info["WKCompanionAppBundleIdentifier"] == "$(PHONE_BUNDLE_IDENTIFIER)"
    assert entitlements["com.apple.developer.healthkit"] is True
    assert entitlements["com.apple.developer.healthkit.background-delivery"] is True
    privacy = plistlib.loads((root / "iOS/PrivacyInfo.xcprivacy").read_bytes())
    assert privacy["NSPrivacyTracking"] is False
    assert {"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]} in privacy["NSPrivacyAccessedAPITypes"]
    assert (root / "Package.swift").is_file()
    assert list((root / "Tests").rglob("*Tests.swift"))
    print(f"PASS: {len(objects)} project objects, {len(files)} file references, 2 app targets, schemes and property lists.")
    print("NOT CHECKED: Swift compilation, XCTest execution, Apple signing, device behavior or visual layout.")


if __name__ == "__main__":
    assert parse_project('{ "text" = "中文"; "items" = (1, "two",); }') == {"text": "中文", "items": [1, "two"]}
    for malformed in ['{ key = 1;', '{ key = 1; key = 2; }', '{} trailing']:
        try:
            parse_project(malformed)
        except ValueError:
            pass
        else:
            raise AssertionError("Parser accepted malformed input")
    check(Path(__file__).resolve().parents[1])
