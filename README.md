# 诗人星图 · Constellation of Poets

中国古典诗人交游关系的交互式三维星座图。每位诗人是一颗发光的星球,诗人之间的赠诗、唱和、送别、悼亡与提及化作星链,诗派与交游圈自然聚成星云。

## 运行

```bash
npm install
npm run dev        # 开发服务器 (http://localhost:5173)
npm run build      # 生产构建 → dist/index.html(单文件,双击即可打开)
npm run generate-data  # 重新生成 public/graph.json
```

> **注意**:项目根目录的 `index.html` 是 Vite 源码模板,直接双击会白屏。
> 想双击打开请先 `npm run build`,然后打开 **`dist/index.html`** —— 构建产物
> 已通过 `vite-plugin-singlefile` 内联全部 JS/CSS 与图数据,无需本地服务器,
> 可直接以 `file://` 方式打开或整个文件发给别人。

## 技术栈

- React 19 + Vite + TypeScript
- [react-force-graph-3d](https://github.com/vasturiano/react-force-graph)(three.js 力导向 3D 图)
- Tailwind CSS v4
- UnrealBloomPass 辉光后期 + 自绘星野粒子
- 数据来自 `public/graph.json`,无需后端

## 交互

| 操作 | 效果 |
| --- | --- |
| 拖拽 / 滚轮 | 旋转、缩放星图 |
| 搜索(姓名或表字) | 定位并聚焦诗人 |
| 点击诗人 | 高亮一度关系,打开右侧详情面板(朝代、存诗、交游、代表诗作) |
| 点击星链 | 展示关系类型、情谊强度与诗证原文 |
| 筛选 | 按朝代、关系类型、星群(社群)过滤 |
| ◎ 重置视角 | 相机回到全景 |
| ☰ 列表模式 | 无 WebGL 设备自动降级;也可手动切换为无障碍 2D 列表 |

关系越强(weight 越高),星链越短越亮。星球大小 ≈ 存诗数量。

## 数据

`public/graph.json` 由 `scripts/generate-data.mjs` 生成:

- **nodes**: `id, name, courtesyName, dynasty, poemCount, group, x, y, z`
- **links**: `source, target, weight (1–10), type, evidence[]`
- **evidence**: `title, author, content, relation`
- 关系类型:`赠诗 / 唱和 / 送别 / 悼亡 / 提及`

约 100 位真实诗人与 80 余段有文献可考的关系(李白—杜甫、元稹—白居易、苏轼—苏辙、辛弃疾—陈亮……)构成数据核心,并程序化扩展到 500 节点 / 3000 连线以验证性能。**凡 `generated: true` 的节点与连线为演示用生成数据**(界面中标注"示例生成数据"),诗证内容为占位文本,请勿引用。

## 性能

- 500 节点 / 3000 连线下保持流畅:节点材质注册表 + 命令式高亮(选中时不重建 three 对象)
- 图数据、邻接、筛选结果全部 `useMemo`;`StarMap` 为 `React.memo` 组件
- 连线默认渲染为 GL line(宽度 0),仅高亮时升级为管线几何
- 无 WebGL 环境自动回退到 2D 列表模式

## 已知说明

- 项目未启用 React `<StrictMode>`:react-force-graph 的命令式 WebGL 实例会被 StrictMode 的模拟卸载销毁(渲染循环冻结),这是上游已知限制。
- 程序生成的跨星群连线可能出现朝代错位(如汉魏诗人"悼"晚唐诗人),属演示数据的随机性,替换真实数据即可消除。
