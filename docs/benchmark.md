# 公开基准：怎么跑、怎么读

## 先划清边界

这里测的是 **检索**，不是端到端答案正确率：

- 给定的问题，能不能把**正确的主题**排到第一（`hit@1`），或排进前 N（`hit@N`）；
- 这一轮注入多少字符（提示词成本）；
- 一次打分的耗时。

端到端的"答案对不对"需要裁判模型和数据集许可，是另一个量级的决定，暂不做。
所以本页数字不能直接和 mem0 / graphiti 论文里的 QA 准确率横比——**口径不同**。

## 数据格式

JSONL，一行一题；`#` 开头的行与空行会被跳过：

```json
{"q":"出现 5xx 应该怎么处理","expect":["deploy-runbook"],"split":"test"}
{"q":"艺术考级对升学有用吗","expect":null,"split":"test"}
```

| 字段 | 含义 |
|---|---|
| `q` | 问题原文（必填，空问题会被跳过并计入坏行） |
| `expect` | 正确的主题 slug；数组表示多个都算对；`null`/省略 = **负例**，不该召回任何主题 |
| `split` | 可选，`tune` / `test`；`--split=` 用来只跑其中一份 |

负例的判据与 `pnpm probe` 一致：没有召回任何主题，**或**最高分低于阈值（默认 0.35，`--threshold=` 可改）。

## 跑

```sh
# 有 TBAOT/dsh-persona-kit 的库
pnpm bench --file=bench.jsonl --persona=验证角色

# 只看留出集、改阈值
pnpm bench --file=bench.jsonl --persona=验证角色 --split=test --threshold=0.4
```

输出每题一行（✓ 命中 / ~ 进前 N / ✗ 未命中），末尾汇总：

```
题数 14｜hit@1 86%（12/14）｜hit@3 86%（12/14）｜平均注入 331 字符｜平均耗时 10.15ms
```

自检：把 `test/probe/questions.json` 转成 JSONL 再跑，`hit@1` 必须与 `pnpm probe` 的数字一致（当前都是 86%）——
不一致说明两条路径的判据被改歪了，先查这个，再谈模型。

## 从公开数据集导入

**首选 LongMemEval**（`xiaowu0162/longmemeval-cleaned`，**MIT**，500 题，覆盖信息抽取/多会话推理/时间推理/知识更新/拒答）。
数据不在 GitHub 仓库里，从 HuggingFace 下载后放到 `bench-data/`（该目录不进版本库）：

| 文件 | 用途 | 直链 |
|---|---|---|
| `longmemeval_s_cleaned.json` | **首选**：小 haystack | https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json?download=true |
| `longmemeval_oracle.json` | 只用证据会话，判断"切分是不是瓶颈" | https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json?download=true |
| `longmemeval_m_cleaned.json` | 大 haystack，后跑 | https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_m_cleaned.json?download=true |

`pnpm import-bench` 只做机械映射，不猜 slug：

```sh
pnpm import-bench --from=locomo.json --out=bench.jsonl \
  --question-field=question --expect-field=gold --split-field=split
```

- 输入可以是 JSON 数组或 JSONL；
- `expect` 留空表示负例；
- **答案到 slug 的映射需要你自己做**：公开数据集给的是自由文本答案，而我们要的是主题 slug
  （`ls ~/.dsh/personas/<角色>/topics`）。这一步是判断，不是转换，工具不替你做。

## 已知受限

- 中文数据集少，跨语言检索会更差；
- 没有答案级评测，所以"检索对了但回答错"这类问题测不出来；
- 公开数据集（LoCoMo 等）的许可与体积需要你自己确认，仓库不内置任何数据集内容。
