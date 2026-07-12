"use strict";

const z = require("zod/v4");

const foodFields = {
  name: z.string().min(1).max(40).describe("食材名称；新增时必填"),
  category: z.string().max(20).optional().describe("品类；省略时默认为其他"),
  quantityText: z.string().max(30).optional().describe("人类可读数量，例如 1 盒"),
  startDate: z.string().nullable().optional().describe("购买或生产日期，YYYY-MM-DD"),
  shelfLifeDays: z.number().int().min(0).max(3650).nullable().optional().describe("保鲜天数，0 到 3650"),
  expiresOn: z.string().nullable().optional().describe("到期日，YYYY-MM-DD；也可由 startDate 和 shelfLifeDays 计算")
};

const foodPatchFields = Object.fromEntries(
  Object.entries(foodFields).map(([key, value]) => [key, value.optional()])
);

const listFoodFields = {
  keyword: z.string().max(100).optional().describe("模糊匹配名称、品类或数量"),
  category: z.string().max(20).optional().describe("精确匹配品类"),
  status: z.enum(["expired", "expiring", "normal"]).optional().describe("按过期状态筛选"),
  expiresFrom: z.string().optional().describe("到期日下界，含当天，YYYY-MM-DD"),
  expiresTo: z.string().optional().describe("到期日上界，含当天，YYYY-MM-DD"),
  limit: z.number().int().min(1).max(100).optional().describe("返回数量，默认 20"),
  offset: z.number().int().min(0).optional().describe("分页偏移，默认 0")
};

const positiveId = z.number().int().positive();
const idBatch = z.array(positiveId).min(1).max(25);
const inputShapes = {
  list_foods: listFoodFields,
  get_foods: { ids: idBatch.describe("要获取的食材 ID，1 到 25 项") },
  create_foods: {
    items: z.array(z.object(foodFields)).min(1).max(25).describe("要新增的食材，1 到 25 项")
  },
  update_foods: {
    items: z.array(z.object({
      id: positiveId.describe("list_foods 或 get_foods 返回的准确食材 ID；不要放进 patch"),
      patch: z.object(foodPatchFields).describe("部分更新对象，只填写确实要修改的字段，至少填写一项；省略的字段保持原值。直接修改到期日时填写 expiresOn；修改 startDate 或 shelfLifeDays 并要求重新计算到期日时，同时填写 expiresOn: null")
    })).min(1).max(25).describe("要修改的食材，1 到 25 项")
  },
  delete_foods: { ids: idBatch.describe("要永久删除的食材 ID，1 到 25 项") }
};

const toolSpecs = [
  {
    name: "list_foods",
    description: "筛选当前用户的食材并返回 ID、到期日和状态。结果按到期紧急度排序并支持分页。",
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "get_foods",
    description: "按准确 ID 批量获取当前用户的 1 到 25 项食材。整批校验；任何 ID 不存在时返回错误。",
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "create_foods",
    description: "批量新增 1 到 25 项食材。每项提供 expiresOn，或同时提供 startDate 和 shelfLifeDays；整批校验并在同一事务中执行。",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: "update_foods",
    description: [
      "按准确 ID 批量、部分更新当前用户的 1 到 25 项食材。参数格式为 items: [{ id, patch }]。",
      "id 必须使用 list_foods 或 get_foods 返回的准确 ID，并放在 item.id；不要把 id 放进 patch。",
      "patch 表示这一项要修改的字段，至少填写一个字段。只填写确实需要改变的 name、category、quantityText、startDate、shelfLifeDays 或 expiresOn；省略的字段保持原值，不要为了补全对象而复制未修改字段。",
      '普通字段示例：{"items":[{"id":12,"patch":{"quantityText":"2 盒","category":"乳品"}}]}。',
      '直接修改到期日示例：{"items":[{"id":12,"patch":{"expiresOn":"2026-07-30"}}]}。',
      '按开始日期和保鲜天数重新计算到期日示例：{"items":[{"id":12,"patch":{"startDate":"2026-07-20","shelfLifeDays":10,"expiresOn":null}}]}；expiresOn: null 用于明确触发重新计算。',
      "如果不修改或不重新计算日期，就不要在 patch 中填写日期字段。整个批次会先完整校验，再在同一事务中执行；任何一项无效时全部不修改。"
    ].join("\n"),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "delete_foods",
    description: "按准确 ID 批量永久删除当前用户的 1 到 25 项食材。整批校验并在同一事务中执行。",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }
].map((tool) => ({ ...tool, inputSchema: inputShapes[tool.name] }));

function jsonParameters(inputSchema) {
  const schema = z.toJSONSchema(z.object(inputSchema));
  delete schema.$schema;
  return schema;
}

const agentToolDefinitions = toolSpecs.map(({ name, description, inputSchema }) => ({
  name,
  description,
  parameters: jsonParameters(inputSchema)
}));

module.exports = { agentToolDefinitions, inputShapes, toolSpecs };
