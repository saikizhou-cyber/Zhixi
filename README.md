# 知息 / Zhixi

Swift + WebKit + HealthKit 的自用健康观察工具。读取用户选择共享的 iPhone 健康数据，在本机展示状态、趋势、睡眠、训练及日常记录。不写入 Apple 健康，不主动上传健康记录；测试和演示数值均为虚构。

## 已验证（2026-11-18）

- [云端编译](https://github.com/saikizhou-cyber/Zhixi/actions/runs/44129185602)：Xcode 27.1、Swift 6.4、iPhoneOS 27.1 SDK。
- 182 项 Web 测试与 17 项 Swift 核心测试全部通过。
- iPhone Simulator、Watch Simulator、iPhone Release 设备版本均编译通过。
- [原生启动检查](https://github.com/saikizhou-cyber/Zhixi/actions/runs/44130078103)：在云端 iPhone Simulator 安装、启动并截图；已人工查看截图，确认原生首页和「连接 Apple 健康」入口正常显示。

构建结果是未签名 `.app`，不是可直接安装的 IPA；真实 HealthKit 授权、Apple Watch 数据同步、后台更新及用户真机表现仍未验证。正式安装及分发需要有效 Apple 签名和账号条件。

## 构建

Actions 中手动运行 `Zhixi native build check` 或 `Zhixi iPhone startup check`。使用标准 macOS runner，job 仅在公开仓库运行，工作令牌仅有 contents:read，未配置 Apple secrets。云端 artifacts 保留 1 天；下载后可在自己的电脑留存。

Windows 可执行：

```powershell
node --test body-status/web/tests/*.test.mjs
py -3 body-status/tools/check_project.py
```

此仓库不包含真实健康记录、登录凭据或签名证书。字体许可随源码附带。
