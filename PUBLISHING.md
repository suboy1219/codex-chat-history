# 发布到 VS Code Marketplace

这个扩展可以发布到 [Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode)。发布本身不复杂，但必须先准备微软账号、Publisher 和 PAT；这些只能由账号所有者完成。

## 一、准备账号

1. 用 Microsoft 账号登录 [Azure DevOps](https://dev.azure.com)，创建一个组织（任意名称）。
2. 打开 [Personal Access Tokens](https://dev.azure.com/_usersSettings/tokens)，新建 token：
   - Organization：选择你的组织
   - Scopes：勾选 **Marketplace → Manage**
   - 记下 token，页面关闭后无法再次查看
3. 打开 [Marketplace 管理页](https://marketplace.visualstudio.com/manage)，创建 Publisher。
   - Publisher ID 会成为扩展 ID 的前半部分，例如 `your-name.codex-history-lens-hkle`
   - **发布后不能修改**，请先想好

## 二、修改项目信息

把 `package.json` 里的 `publisher` 改成刚创建的 Publisher ID：

```json
{
  "publisher": "your-publisher-id"
}
```

发布前确认这些字段：

- `name`：`codex-history-lens-hkle`，扩展 ID 的后半部分
- `version`：遵循 semver；每次发布必须递增
- `icon`：`media/icon.png`，必须是至少 128×128 的 PNG（已准备）
- `license`：`MIT`，根目录已有 `LICENSE`
- `README.md` / `README.en.md`：商店页面会渲染 `README.md`
- `docs/images/`：README 图片，必须随 VSIX 一起打包
- `repository`：建议填写 GitHub 地址；没有会收到警告，但不阻止发布

扩展 ID 最终是 `publisher.name`，例如 `hkle.codex-history-lens-hkle`。

## 三、本地打包校验

项目自带的 `npm run build:vsix` 是零依赖打包器，适合本地安装测试。正式发布建议用官方 `vsce`，它会检查图标、README、LICENSE 等商店要求：

```powershell
npx --yes @vscode/vsce package
```

生成 `codex-history-lens-hkle-1.2.0.vsix`。如果报错，按提示修复后重新执行。

## 四、发布

方式一：命令行发布。

```powershell
npx --yes @vscode/vsce login your-publisher-id
# 粘贴 PAT

npx --yes @vscode/vsce publish
```

也可以直接带上 token，避免交互：

```powershell
$env:VSCE_PAT = "你的 PAT"
npx --yes @vscode/vsce publish -p $env:VSCE_PAT
```

方式二：网页上传。

1. 执行 `npx --yes @vscode/vsce package`
2. 打开 [Marketplace 管理页](https://marketplace.visualstudio.com/manage)
3. 选择 Publisher → **New extension** → **Visual Studio Code**
4. 上传生成的 `.vsix`，等待审核/上架

## 五、更新版本

每次发布前修改 `package.json` 的 `version`，并在 `CHANGELOG.md` 记录变更，然后：

```powershell
npx --yes @vscode/vsce publish patch
```

`patch` / `minor` / `major` 会自动递增版本号。

## 六、注意事项

- **非官方声明**：README 已注明这是社区扩展、与 OpenAI 无隶属关系。不要使用 OpenAI 官方 Logo，也不要把自己描述成官方产品。
- **隐私**：扩展只读取本地会话，不上传数据。若以后增加遥测或联网功能，必须在 README 明确说明并提供关闭方式。
- **PAT 安全**：不要把 PAT 写进仓库。CI 中使用 GitHub Secrets，例如 `VSCE_PAT`。
- **首次发布**：Marketplace 可能对新 Publisher 做人工审核；如果卡住，检查 Publisher 是否完成验证。
- **扩展 ID 不可变**：Publisher ID 和扩展 `name` 一旦发布就固定，改名等于发布一个新扩展。

## 七、GitHub Actions 自动发布（可选）

在仓库 Secrets 中添加 `VSCE_PAT`，然后创建 `.github/workflows/publish.yml`：

```yaml
name: Publish VS Code Extension

on:
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci || npm install
      - run: npm test
      - run: npx --yes @vscode/vsce publish -p ${{ secrets.VSCE_PAT }}
```

发布完成后，在 Marketplace 管理页确认版本和 README 图片显示正常。
