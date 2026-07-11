export default {
  name: "market-summary",
  async run(context) {
    return {
      message: "返回给 Pi Runtime 的结构化行情摘要",
      input: context.input,
      subscriptions: context.subscriptions ?? [],
      dataSource: context.dataSource ?? "auto"
    };
  }
};
