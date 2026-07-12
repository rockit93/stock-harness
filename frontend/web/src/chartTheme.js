export function chartThemeStyles() {
  const theme = document.documentElement.dataset.theme || "midnight";
  const palettes = {
    midnight: {
      grid: "rgba(126, 163, 150, .13)", axis: "rgba(126, 163, 150, .22)",
      text: "#71877f", crosshair: "rgba(154, 190, 177, .42)", panel: "#14251f",
    },
    obsidian: {
      grid: "rgba(137, 154, 201, .13)", axis: "rgba(137, 154, 201, .22)",
      text: "#74819d", crosshair: "rgba(167, 183, 226, .42)", panel: "#182238",
    },
    daylight: {
      grid: "rgba(91, 111, 104, .11)", axis: "rgba(91, 111, 104, .2)",
      text: "#7b8d86", crosshair: "rgba(70, 94, 85, .38)", panel: "#ffffff",
    },
  };
  const colors = palettes[theme] || palettes.midnight;
  return {
    grid: {
      horizontal: { color: colors.grid },
      vertical: { color: colors.grid },
    },
    xAxis: {
      axisLine: { color: colors.axis }, tickLine: { color: colors.axis }, tickText: { color: colors.text },
    },
    yAxis: {
      axisLine: { color: colors.axis }, tickLine: { color: colors.axis }, tickText: { color: colors.text },
    },
    separator: { color: colors.axis, activeBackgroundColor: colors.grid },
    crosshair: {
      horizontal: { line: { color: colors.crosshair }, text: { borderColor: colors.axis, backgroundColor: colors.panel } },
      vertical: { line: { color: colors.crosshair }, text: { borderColor: colors.axis, backgroundColor: colors.panel } },
    },
    candle: {
      tooltip: { text: { color: colors.text }, rect: { color: colors.panel, borderColor: colors.axis } },
      priceMark: { high: { color: colors.text }, low: { color: colors.text } },
    },
    indicator: { tooltip: { text: { color: colors.text } } },
  };
}
