<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AreaSeries, ColorType, createChart, createSeriesMarkers, LineSeries } from "lightweight-charts";

const props = defineProps({
  series: { type: Array, default: () => [] },
  height: { type: Number, default: 300 },
  locale: { type: String, default: "zh-CN" },
  valueFormat: { type: String, default: "number" },
});

const container = ref(null);
let chart;
let resizeObserver;
let themeObserver;

function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: value("--app-surface", "#ffffff"),
    text: value("--app-text-muted", "#64748b"),
    border: value("--app-border-strong", "#e2e8f0"),
    grid: value("--app-border", "#eef2f7"),
    crosshair: value("--app-text-secondary", "#334155"),
  };
}

function formatValue(value) {
  if (props.valueFormat === "percent") return `${Number(value).toFixed(1)}%`;
  if (props.valueFormat === "currency") {
    return new Intl.NumberFormat(props.locale, { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat(props.locale, { maximumFractionDigits: 2 }).format(value);
}

function destroyChart() {
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  chart?.remove();
  chart = undefined;
}

function renderChart() {
  if (!container.value) return;
  destroyChart();
  const colors = themeColors();
  chart = createChart(container.value, {
    width: container.value.clientWidth,
    height: props.height,
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.text,
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    rightPriceScale: { borderColor: colors.border },
    timeScale: { borderColor: colors.border, timeVisible: false },
    crosshair: {
      vertLine: { labelBackgroundColor: colors.crosshair },
      horzLine: { labelBackgroundColor: colors.crosshair },
    },
    localization: { locale: props.locale, priceFormatter: formatValue },
  });

  for (const item of props.series) {
    const common = { lineWidth: 2, title: item.name || "" };
    const chartSeries = item.type === "area"
      ? chart.addSeries(AreaSeries, {
          ...common,
          lineColor: item.color,
          topColor: item.topColor || "rgba(239, 68, 68, 0.08)",
          bottomColor: item.bottomColor || "rgba(239, 68, 68, 0.28)",
        })
      : chart.addSeries(LineSeries, { ...common, color: item.color });
    chartSeries.setData(item.data || []);
    if (item.markers?.length) createSeriesMarkers(chartSeries, item.markers);
  }
  chart.timeScale().fitContent();
  resizeObserver = new ResizeObserver(() => {
    if (container.value) chart?.applyOptions({ width: container.value.clientWidth });
  });
  resizeObserver.observe(container.value);
}

onMounted(() => {
  renderChart();
  themeObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "data-theme")) renderChart();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
});
watch(() => [props.series, props.height, props.locale, props.valueFormat], renderChart, { deep: true });
onBeforeUnmount(() => {
  themeObserver?.disconnect();
  destroyChart();
});
</script>

<template>
  <div ref="container" class="unified-time-series-chart" role="img" aria-label="时间序列图表"></div>
</template>

<style scoped>
.unified-time-series-chart { width: 100%; min-height: 300px; background: var(--app-surface); }
</style>
