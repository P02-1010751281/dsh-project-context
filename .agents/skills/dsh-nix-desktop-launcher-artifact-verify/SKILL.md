---
name: dsh-nix-desktop-launcher-artifact-verify
description: "Verify a change to the Nix-built dsh desktop launcher (launch.sh / wrapper / pre-boot checks) against the real built store artifact in an env -i harness, because the repo source and PATH wrapper are not what actually runs and the change is not live until home-manager switch."
---

## 适用场景

在 `/etc/nixos` 的 `pkgs/dsh-desktop/`（`launch.sh`、`default.nix` 的 wrapper）里加/改 exec 前的启动逻辑，或核对「这次改动到底生效了没有」。触发信号：用户问「需要重启桌面端吗」，或某逻辑在源码里看着对、行为却像没接上。

## 铁律：仓库源码不是运行产物

1. **launch.sh 会被 `makeWrapper` 内联进 wrapper**，产物里可能根本不存在 `<out>/lib/dsh-desktop/launch.sh`。直接在 wrapper 里搜关键字得 0 命中 ≠ 接线失败。
2. 找**真正的 exec 目标**：读 wrapper 尾部（用 `read` 或取尾部若干行），找 `exec "/nix/store/<hash>-launch.sh"`。壳脚本在**独立的 store 路径**（与 dsh-desktop 产物不同 hash）。
3. **这个 hash 可能与你刚构建的那个不是同一个**（本仓实测：live wrapper 指向 `0rr2jfp6…-launch.sh`，而本地构建产物是 `gwzaa2mj…`）。先确定「哪个 launch.sh 真的会被跑」，再谈验证。
4. 与该路径比对：`diff <store 的 launch.sh> <仓库工作区副本>` 应为空（identical）；不等说明产物不是当前源码。

## 端到端验证必须用真实产物 + 干净环境

拿**产物里的那个脚本**跑，不要用仓库副本，也不要写一个模拟块代替。隔离环境的关键：

- 清空环境并只喂必要的变量（`env -i` 思路）。delegate 给其它工具时用绝对路径参数（如体检用 bash、coreutils 的路径），**不依赖调用方 PATH**。
- **只传对的那个变量**。本仓的体检脚本读 `DSH_PROFILES_ROOT`，**不认 `DSH_HOME`**；只传后者会去查另一个目录，可能恰好一片全绿——这是本项目撞过两次的假绿类型。
- 把**体检器的「跳过/正常态」输出 grep 掉**（profile 未初始化时它打印一行跳过并 exit 0），正常态不该灌噪音。
- **体检器零输出要当缺陷报**，不要当成「补丁正常」。

三种状态各跑一遍并确认：失效态 → 醒目警告 + 原文 + 落盘日志 + **仍继续 exec**；成功态 → 安静、exit 0、不写日志；无 profile → 零输出。

## 生效判据：PATH 上的 wrapper 只由 home-manager switch 更换

**重启桌面端 / 再点一次图标不会换 wrapper** —— wrapper 由 PATH 在启动时刻选定，而 PATH 上的 wrapper 在 `home-manager switch` 之后才更新（实测：重启后仍在跑旧 wrapper）。工具面脚本走**绝对路径**调用则不受此影响：改它立即生效，但改 wrapper / launch.sh 必须 switch。

判据（任选其一，都要真跑）：
- `readlink -f $(command -v dsh-desktop)` 是否指向新构建的产物；
- `<store>/launch.sh` 与仓库工作区副本是否 `diff` 为空。

不等 = 还差一次 `home-manager switch`。这一步动系统 generation，**不要擅自执行**，先向用户提出。

## 并发写者

`/etc/nixos` 常有另一个会话在编辑（典型是 `log.md`）：只 `git add <paths>`，`git commit -F <msg> -- <paths>`（选项在 `--` 前），**绝不 `add -A`**；提交后核 `git show --stat HEAD` 只含自己的文件，再用 `git log` 确认没吞掉别人的提交。某文件正被并发编辑（点名过 `log.md`）时就不碰它，改动在自己的文档里自述。
