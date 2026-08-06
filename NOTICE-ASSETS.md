# AISLAND MVP2 资产来源与许可

| 资产 | 来源 | 作者 | 许可 | 用途 |
| --- | --- | --- | --- | --- |
| Zoria Tileset (overworld/sprites/palette) | OpenGameArt (zoria-tileset) | ZoriaRPG | CC-BY 4.0 | 树木、箱/岩道具与参考色板 |
| Whispers of Avalon Grassland (ground/cliff/trees/waterflow) | OpenGameArt | Len Fabin | CC-BY 3.0 | 草地/悬崖/水流动画补充 |
| Island Tileset | OpenGameArt | 见许可文件 | OGA-BY 3.0 | 椰树/沙水参考 |
| beach_tileset_0.png | OpenGameArt (outdoor-tileset-0) | Calciumtrice | CC-BY 4.0 | 树木/岩块/容器等可识别图块与参考色板 |
| forest_tileset_0.png | 同上 | Calciumtrice | CC-BY 4.0 | 火焰动画、容器、参考色板 |
| trees_23.png | 同上 | Calciumtrice | CC-BY 4.0 | 椰树/树木精灵 |
| water_20.png + water-frames | 同上 | Calciumtrice | CC-BY 4.0 | 海水动画参考 |
| Ninja Adventure ninja_blue/samurai_green/samurai_blue/Shadow | GitHub pixel-boy/NinjaAdventure | Pixel-boy | CC0 | 三位幸存者行走动画（调色板换色） |
| generated-terrain/*.png（11 类地形底块 tileset） | OpenAI Image API 生成 | AISLAND 项目 | 自产 | 16-bit 像素风 8×8 tileset，每格 32px 像素画 4 倍放大 |
| generated-terrain/transitions/*.png（9 对过渡 sheet） | OpenAI Image API 生成 | AISLAND 项目 | 自产 | 每张 8×8 sheet：A 主体+B 条带（行 0-3）与 B 主体+A 条带（行 4-7），N/S/W/E 四向边缘模块 |
| generated-props/*.png（道具） | OpenAI Image API 生成 | AISLAND 项目 | 自产 | 像素风道具原图（品红底抠透明） |

许可全文：`assets/source/mvp2/licenses/`。

## 主地形图块来源（AI 直接生成的像素风 tileset）

`terrain-bases.png` 的 11 类底块来自 `generated-terrain/*.png`：AI 直接生成的
16-bit 像素风 tileset（无后期量化/抖动），构建期按 4 倍最近邻还原为 32px
逻辑图块；每类从 8×8 sheet 自动挑选纹理最丰富且边缘色一致的多变体（最多 6 个），
地图按种子混用，消除大面积重复。

## 边缘模块（tileset 边缘拼接）

`terrain.png` 中相邻地形过渡优先使用 `generated-terrain/transitions/*.png`
的真实边缘模块（整块贴入），多边交界叠加条带。每张 sheet 生成后经
`scripts/map/validate-transitions.ts` 自动校验 8 个方向（N/S/W/E），
`npm run map:all` 会执行该校验门；若生成器未画出右侧条带（E），以左侧（W）
条带的水平镜像补齐——镜像翻转是 tileset 行业标准做法，像素级一致，
无额外风格化处理。

角色动画帧从 Ninja Adventure 提取并做调色板换色（16px → 32px nearest-neighbor），
生成 `characters.png`（林澈/石磊/苏禾，四方向行走 + 动作帧）。

`props.png` 由 Calciumtrice 树木/箱/岩与 AI 生成像素道具（抠透明后）规范化而来；
`assets:audit` 校验生产图片与 manifest 映射。
