# AISLAND MVP2 资产来源与许可

| 资产 | 来源 | 作者 | 许可 | 用途 |
| --- | --- | --- | --- | --- |
| Zoria Tileset (overworld/sprites/palette) | OpenGameArt (zoria-tileset) | ZoriaRPG | CC-BY 4.0 | 主地形底块（草/沙/水/土/岩/暗林）、树木、道具 |
| Whispers of Avalon Grassland (ground/cliff/trees/waterflow) | OpenGameArt | Len Fabin | CC-BY 3.0 | 草地/悬崖/水流动画补充 |
| Island Tileset | OpenGameArt | 见许可文件 | OGA-BY 3.0 | 椰树/沙水参考 |
| beach_tileset_0.png | OpenGameArt (outdoor-tileset-0) | Calciumtrice | CC-BY 4.0 | 参考色板；树木/岩块/容器等可识别图块 |
| forest_tileset_0.png | 同上 | Calciumtrice | CC-BY 4.0 | 火焰动画、容器、参考色板 |
| trees_23.png | 同上 | Calciumtrice | CC-BY 4.0 | 椰树/树木精灵 |
| water_20.png + water-frames | 同上 | Calciumtrice | CC-BY 4.0 | 海水动画参考 |
| Ninja Adventure ninja_blue/samurai_green/samurai_blue/Shadow | GitHub pixel-boy/NinjaAdventure | Pixel-boy | CC0 | 三位幸存者行走动画（调色板换色） |

许可全文：`assets/source/mvp2/licenses/`。

## 主地形图块来源（真实游戏资源）

`terrain-bases.png` 的 11 类底块全部来自真实像素素材：Zoria（NES 调色板，
16px）为主，Whispers of Avalon 悬崖为补充；16px 素材 2 倍最近邻放大到
32px 逻辑图块。边缘过渡仍由构建期 Wang 合成（四角语义），运行时零混色。

## 本项目的派生图块

`terrain.png`（主地形 Wang 集）为**程序化像素美术**：统一色板、确定性噪声、
四角语义构造的边缘过渡（16 corner tiles/过渡对），非 AI 生成、非运行时混色。
色板参照 Calciumtrice 的海滩/森林配色（干沙/湿沙/浅水/深水/草地/林地/泥地/岩地/悬崖壁）。

角色动画帧从 Ninja Adventure 提取并做调色板换色（16px → 32px nearest-neighbor），
生成 `characters.png`（林澈/石磊/苏禾，四方向行走 + 动作帧）。

`props.png` 与 `effects.png` 由 Calciumtrice 树木/火焰帧与 Ninja Adventure
可识别道具规范化而来；`assets:audit` 校验生产图片与 manifest 映射。
