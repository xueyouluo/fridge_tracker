# 4.2 寸墨水屏外壳模型

本目录由独立的 `text2cad` 工作目录整合而来，是鲜知贴 4.2 寸墨水屏设备的
两件式外壳模型。尺寸单位均为毫米，参数化 Python 源码是几何设计的事实来源，
STEP、STL 和 3MF 是由源码导出的交付文件。

## 设计方法：全程由大模型完成建模

这套外壳使用 [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad/tree/main)
项目提供的 CAD Skill 生成。整个过程中没有人工在 Fusion 360 或其他 CAD 软件中
手工绘制模型：尺寸整理、结构设计、参数化源码、螺丝柱与开孔、装配模型和导出
文件都交给 coding agent 完成。我们使用的 coding agent 是 Codex，模型为
`GPT-5.6 SOL`。

CAD Skill 可以安装到 Codex、Claude Code 等支持 Agent Skills 或插件的 coding
agent。建议以项目上游的最新说明为准；当前推荐的通用安装方式是：

```sh
npx skills install earthtojake/text-to-cad
```

也可以使用 Codex 或 Claude Code 的原生插件命令：

```sh
# Codex
codex plugin marketplace add earthtojake/text-to-cad
codex plugin add cad@text-to-cad

# Claude Code
claude plugin marketplace add earthtojake/text-to-cad
claude plugin install cad@text-to-cad
```

如果安装后没有显示 CAD Skill，请按照上游说明重启 coding agent。

### 我们的生成过程

1. 使用卡尺详细测量墨水屏、ESP32-C3 Super Mini、电池、墨水屏驱动板、充放电
   模块、开关、接口位置和螺丝等实物尺寸，并把尺寸、朝向和走线要求告诉 agent。
2. 要求 agent 根据这些约束生成前框、后壳和内部电子件包络。本版本使用螺丝固定；
   如果更适合自己的装配方式，也可以要求 agent 设计成卡扣结构。
3. 让 agent 生成参数化源码、STEP 装配和 STL/3MF 打印文件，并检查尺寸、配合间隙、
   开孔位置、螺丝咬合深度及零件干涉。
4. 在 Fusion 360 中打开 STEP 或 STL 检查外形和内部布局。STEP 更适合查看装配结构
   和继续编辑，STL 适合检查最终打印网格。
5. 满意后把 STL 或 3MF 导入 Bambu Studio，切片并发送到拓竹打印机进行 3D 打印。

大模型第一次生成的结果通常不会直接达到最终要求。尺寸理解、接口方向、内部布局、
螺丝长度和打印公差都可能需要通过多轮交互逐项修正。我们实际打印了多个版本，结合
装配结果继续反馈和调整，才得到当前比较合适的版本。因此，建议把第一次打印当作试装
件，用实物复测结果继续让 agent 修改参数，而不是期待一次生成即可完成。

## 文件说明

- `ink_frame_common.py`：集中定义屏幕、电子件、开孔、配合和紧固参数。
- `ink_frame_front_bezel.py`：前框生成器。
- `ink_frame_rear_shell.py`：后壳生成器。
- `ink_frame_assembly.py`：带电子件与螺丝包络的完整装配生成器。
- `design_checks.py`：参数、包络和 BREP 干涉检查。
- `*.step`：Fusion 360 等 CAD 软件使用的装配与独立零件。
- `stl/`、`3mf/`：前框和后壳的打印文件。
- `review/`：历次装配、透明、爆炸和后壳开口审图快照。
- `CAD_BRIEF.md`：设计约束、当前尺寸和待实物复测项目。
- `PRINT_NOTES.md`：Bambu Lab P2S 首版打印与装配说明。

## 打开与修改

完整布局检查优先打开 `ink_frame_assembly.step`。只检查或修改打印件时，分别
打开 `ink_frame_front_bezel.step` 和 `ink_frame_rear_shell.step`；不要把 STL
或 3MF 当作后续参数化编辑的源文件。

修改尺寸时先编辑 `ink_frame_common.py`，然后重新运行三个生成器并执行：

```sh
python models/ink_frame_v1/design_checks.py
```

生成器依赖 Python 3.12、`build123d` 和 text-to-cad 工具链提供的 `cadpy`。
仓库不包含原工作目录的 `.venv`；请在项目本地虚拟环境中安装依赖，避免污染
系统 Python。导出新文件后，应重新运行设计检查，并对完整装配和两个独立零件
做一次 CAD 视图检查。

## 当前边界

当前版本包含前框、后壳、屏幕与电子件包络、FPC 路径及 M2.5 螺丝包络，未
包含桌面支脚或墙挂孔。Type-C、开关、FPC 弯曲半径和电子件最高点仍须以实物
复测，具体清单见 `CAD_BRIEF.md`。
