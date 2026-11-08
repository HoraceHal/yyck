# 部署说明(Cloudflare Workers + GitHub)

本站是纯静态网页,`wrangler.jsonc` 已配好:`public/` 目录里的文件会原样发布。

## 推荐:用 Cloudflare 连接 GitHub 仓库(推送即发布)
1. Cloudflare 控制台 → Workers 和 Pages → 创建 → 导入 Git 仓库,选择本仓库。
2. 构建设置:
   - **构建命令**:`node tools/build-version.js`(生成 `version.json`,用于"课程已更新"提示;留空也能发布,只是用户收不到更新提示)
   - **部署命令**:`npx wrangler deploy`
   - 根目录:`/`
3. 保存并部署。以后每次 `git push` 到 `main`,Cloudflare 会自动构建并发布。

修改构建命令:Workers 和 Pages → 你的项目 → 设置 → 构建 → 构建命令。

## 加新课的流程
编辑 `public/lessons-extra.js` → `node tools/check-data.js`(本地校验)→ `git push`。
GitHub 上的 `Check` 工作流会再校验一次数据;Cloudflare 负责发布。

## 用户端怎么拿到更新
- 已打开网页的用户:每 10 分钟(以及切回页面时)检查 `version.json`,发现新版本弹出"刷新获取"。
- 新增的课在首页带 **NEW** 标记,点进去后消失。
- 学习进度保存在浏览器里,更新不会丢。

## 手动发布(备用)
```bash
npx wrangler login
npx wrangler deploy
```

## 注意事项
- **Worker 名称**:`wrangler.jsonc` 里的 `name` 要和 Cloudflare 里的项目名一致(当前为 `yyck`),否则构建日志会出现名称不匹配的警告。
- **公开访问**:发布后是公开网址;只想自己用的话,可用 Cloudflare Access 加登录保护。
- **学习进度**保存在每位访问者自己的浏览器里,换设备不会同步。
- **语音**取决于访问者浏览器是否有粤语(zh-HK)语音。Edge、Chrome 通常有;没有时页面会提示解决办法。
- **更新后页面没变**:按 Ctrl+F5 强制刷新。
- 课程内容(尤其粤拼)请让会粤语的人审核后再推送,本项目不会自动生成课程。
