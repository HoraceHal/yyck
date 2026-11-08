# 部署到 Cloudflare Workers(静态站)

本站是纯静态网页(HTML/JS/CSS),没有后端。语音朗读由访问者的浏览器完成,所以托管起来很省事。
`wrangler.jsonc` 已经配好:`public/` 目录里的所有文件会原样发布。

## 准备
- 一个 Cloudflare 账号(免费版即可):https://dash.cloudflare.com/sign-up
- 安装 Node.js(LTS 版本):https://nodejs.org

## 方式 A:命令行发布(推荐,约 5 分钟)

1. 打开终端,进入本项目文件夹(里面有 `wrangler.jsonc` 和 `public/`)。
2. 登录 Cloudflare(会自动弹出浏览器,点 Allow 授权):
   ```bash
   npx wrangler login
   ```
3. 发布:
   ```bash
   npx wrangler deploy
   ```
   第一次会提示注册一个 `workers.dev` 子域名,按提示起个名字即可。成功后终端会打印网址:
   `https://yuetung.<你的子域名>.workers.dev`
4. 手机、电脑浏览器打开这个网址就能用。

**以后更新**:改完 `public/` 里的文件,再运行一次 `npx wrangler deploy`。
**本地预览**:`npx wrangler dev`(默认 http://localhost:8787)。

## 方式 B:GitHub 推送后自动发布(已配置好)
仓库里的 `.github/workflows/deploy.yml` 会在每次推送到 `main` 分支时:
1. **校验课程数据**(`node tools/check-data.js`:每个汉字必须对应一个合法粤拼音节,不通过就不发布);
2. 生成新的 `version.json`;
3. 自动发布到 Cloudflare Workers。

只需要**一次性**设置两个密钥:

1. 在 Cloudflare 控制台 → 右上角头像 → My Profile → API Tokens → Create Token,选模板 **Edit Cloudflare Workers**,创建后复制 Token(只显示一次)。
2. 在 Cloudflare 控制台首页(Workers & Pages 概览)找到你的 **Account ID** 并复制。
3. 在 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret,添加:
   - `CLOUDFLARE_API_TOKEN` = 上面的 Token
   - `CLOUDFLARE_ACCOUNT_ID` = 你的 Account ID
4. 如果账号还没注册过 `workers.dev` 子域名,先用方式 A 手动发布一次(或在控制台 Workers & Pages 里先注册子域名)。

之后加新课的流程:**编辑 `public/lessons-extra.js` → `node tools/check-data.js` → git push**,几分钟后线上就更新了。

### 用户端怎么拿到更新
- 已经打开着网页的用户:页面每 10 分钟(以及切回页面时)检查 `version.json`,发现新版本会在顶部弹出"课程已更新,刷新获取"。点一下刷新即可,不会打断正在做的练习。
- 新增的课程在首页带 **NEW** 标记,点进去后消失。
- 学习进度保存在浏览器里,更新不会丢。

> 注意:自动发布只管"把你推送的内容发出去"。课程内容(尤其粤拼)仍需要你或会粤语的人审核后再推送,本项目不会自动生成课程。

## 可选:绑定自己的域名
域名需要已经托管在 Cloudflare。控制台 → Workers & Pages → yuetung → Settings → Domains & Routes → Add → Custom domain。

## 注意事项
- **名字冲突**:如果提示 Worker 名字已被占用,改 `wrangler.jsonc` 里的 `name`(只能用小写字母、数字、短横线)。
- **公开访问**:发布后是公开网址,任何知道链接的人都能打开。如果只想自己用,可以用 Cloudflare Access 加一层登录保护。
- **学习进度**保存在每位访问者自己浏览器的 localStorage 里,换设备或清除浏览器数据不会同步。
- **语音**:取决于访问者的浏览器是否有粤语(zh-HK)语音。Edge、Chrome 通常有;没有时页面会提示解决办法。
- **更新后页面没变**:浏览器缓存,按 Ctrl+F5 强制刷新。

## 常见报错
| 现象 | 处理 |
|---|---|
| `wrangler login` 没弹出浏览器 | 复制终端里的链接,手动在浏览器打开 |
| 找不到 `public` 目录 | 确认终端在含 `wrangler.jsonc` 的文件夹里 |
| 提示未登录/权限不足 | 重新运行 `npx wrangler login` |
