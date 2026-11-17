# 知息 / Zhixi

Swift + WebKit + HealthKit 的自用健康观察工具。仅本机只读；当前不是可安装 IPA。

Actions 中手动运行 Zhixi native build check，使用标准 macOS runner，执行 Web/Swift 核心测试及 iOS/watchOS 无签名编译。不需要 Apple 账号或个人健康数据。源码中的 demo/test 数值为虚构数据。

Windows 可执行：`node --test body-status/web/tests/*.test.mjs`、`py -3 body-status/tools/check_project.py`。

构建结果是未签名 .app，仍需有效 Apple 签名和分发才能安装到 iPhone。此仓库不包含健康记录、凭据或签名证书。
