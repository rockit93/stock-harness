<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { Markdown } from "@tiptap/markdown";

const props = defineProps({
  modelValue: { type: String, default: "" },
  loading: Boolean,
  disabled: Boolean,
  placeholder: { type: String, default: "输入 @ 指定角色、# 选择股票、/ 调用能力…" },
  roles: { type: Array, default: () => [] },
  subscriptions: { type: Array, default: () => [] },
  skills: { type: Array, default: () => [] },
  plugins: { type: Array, default: () => [] },
  starters: { type: Array, default: () => [] },
  supportsImages: Boolean,
  supportsFiles: { type: Boolean, default: true },
  attachments: { type: Array, default: () => [] },
  showAttachments: { type: Boolean, default: true },
  showSubmit: { type: Boolean, default: true },
});
const emit = defineEmits(["update:modelValue", "update:document", "update:attachments", "submit", "select-role", "attachment-error"]);
const command = ref(null);
const activeIndex = ref(0);
const dragActive = ref(false);
let dragDepth = 0;
let externalUpdate = false;

const commandMeta = {
  "@": { title: "指定角色", empty: "暂无可用角色" },
  "#": { title: "选择订阅股票", empty: "暂无订阅股票" },
  "/": { title: "调用能力", empty: "暂无可用技能或插件" },
};

const suggestions = computed(() => {
  if (!command.value) return [];
  const query = command.value.query.toLowerCase();
  let values = [];
  if (command.value.trigger === "@") {
    values = props.roles.map((role) => ({ type: "role", id: role.id, label: role.name, description: role.responsibility || "指定本轮对话角色", icon: "@" }));
  } else if (command.value.trigger === "#") {
    values = props.subscriptions.map((stock) => ({ type: "stock", id: stock.id, label: stock.symbol, description: stock.stockName || stock.market || "订阅股票", stock, icon: "#" }));
  } else {
    values = [
      ...props.starters.map((item) => ({ type: "starter", id: `starter-${item.title}`, label: item.title, description: item.prompt, prompt: item.prompt, icon: item.icon || "↗", group: "常用任务" })),
      ...props.skills.map((skill) => ({ type: "skill", id: `skill-${skill.id ?? skill.name}`, label: skill.name, description: skill.description || "使用此技能处理任务", icon: "S", group: "技能" })),
      ...props.plugins.filter((plugin) => plugin.status !== "disabled").map((plugin) => ({ type: "plugin", id: `plugin-${plugin.id ?? plugin.name}`, label: plugin.name, description: plugin.description || "调用此插件", icon: "P", group: "插件" })),
    ];
  }
  return values.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query)).slice(0, 10);
});

function refreshCommand(current) {
  const { from } = current.state.selection;
  const before = current.state.doc.textBetween(0, from, "\n", "\0");
  const match = before.match(/(?:^|\s)([@#/])([^\s@#/]*)$/);
  command.value = match ? { trigger: match[1], query: match[2], from: from - match[1].length - match[2].length, to: from } : null;
  activeIndex.value = 0;
}

const editor = useEditor({
  content: props.modelValue,
  contentType: "markdown",
  editable: !props.disabled,
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: props.placeholder }),
    Mention.configure({ HTMLAttributes: { class: "chat-mention" }, renderText: ({ node }) => `@${node.attrs.label || node.attrs.id}` }),
    Markdown,
  ],
  editorProps: {
    attributes: { class: "rich-chat-editor", role: "textbox", "aria-multiline": "true" },
    handleKeyDown: (_, event) => {
      if (command.value && suggestions.value.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          activeIndex.value = (activeIndex.value + direction + suggestions.value.length) % suggestions.value.length;
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          selectSuggestion(suggestions.value[activeIndex.value]);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          command.value = null;
          return true;
        }
      }
      if (props.showSubmit && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        emit("submit");
        return true;
      }
      return false;
    },
  },
  onUpdate: ({ editor: current }) => {
    refreshCommand(current);
    if (externalUpdate) return;
    emit("update:modelValue", current.getMarkdown().trim());
    emit("update:document", current.getJSON());
  },
  onSelectionUpdate: ({ editor: current }) => refreshCommand(current),
});

function selectSuggestion(item) {
  if (!editor.value || !command.value || !item) return;
  const chain = editor.value.chain().focus().deleteRange({ from: command.value.from, to: command.value.to });
  if (item.type === "role") {
    chain.insertContent([{ type: "mention", attrs: { id: `role:${item.id}`, label: item.label } }, { type: "text", text: " " }]).run();
    emit("select-role", item.id);
  } else if (item.type === "stock") {
    chain.insertContent(`#${item.stock.symbol}${item.stock.stockName ? `(${item.stock.stockName})` : ""} `).run();
  } else if (item.type === "starter") {
    chain.insertContent(`${item.prompt} `).run();
  } else {
    chain.insertContent(`${item.type === "skill" ? "使用技能" : "调用插件"}「${item.label}」：`).run();
  }
  command.value = null;
}

const canSubmit = computed(() => Boolean(props.modelValue.trim() || props.attachments.length));
watch(() => props.disabled, (value) => editor.value?.setEditable(!value));
watch(() => props.modelValue, (value) => {
  if (!editor.value || editor.value.getMarkdown().trim() === value.trim()) return;
  externalUpdate = true;
  editor.value.commands.setContent(value || "", { contentType: "markdown", emitUpdate: false });
  externalUpdate = false;
});

function clear() { editor.value?.commands.clearContent(true); command.value = null; }
defineExpose({ clear, focus: () => editor.value?.commands.focus() });
onBeforeUnmount(() => editor.value?.destroy());

function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  const next = [...props.attachments];
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isText = file.type.startsWith("text/") || /\.(md|txt|csv|json|ya?ml|xml|log|js|ts|vue|py|sql)$/i.test(file.name);
    if (file.size > 10 * 1024 * 1024) {
      emit("attachment-error", `${file.name} 超过 10 MB`);
      continue;
    }
    if (isImage && !props.supportsImages) {
      emit("attachment-error", "当前模型不支持图片理解，请切换视觉模型");
      continue;
    }
    if (!isImage && (!props.supportsFiles || !isText)) {
      emit("attachment-error", `${file.name} 暂不支持；当前可上传文本、Markdown、CSV、JSON 和代码文件`);
      continue;
    }
    next.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      kind: isImage ? "image" : "text",
      dataUrl: isImage ? await readAsDataUrl(file) : undefined,
      text: isText ? await file.text() : undefined,
    });
  }
  emit("update:attachments", next.slice(0, 8));
}

async function pickAttachments(event) {
  await addFiles(event.target.files);
  event.target.value = "";
}

function onDragEnter(event) {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  dragDepth += 1;
  dragActive.value = true;
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragActive.value = false;
}

function onDragOver(event) {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.dataTransfer.dropEffect = "copy";
}

async function onDrop(event) {
  dragDepth = 0;
  dragActive.value = false;
  if (!event.dataTransfer?.files?.length) return;
  await addFiles(event.dataTransfer.files);
}

function removeAttachment(id) {
  emit("update:attachments", props.attachments.filter((item) => item.id !== id));
}
</script>

<template>
  <div
    class="rich-chat-composer"
    :class="{ disabled, 'drag-active': dragActive }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="dragActive" class="attachment-drop-overlay">
      <span>＋</span>
      <strong>拖放到这里添加附件</strong>
      <small>{{ supportsImages ? '支持图片与文本文件' : '当前模型支持文本文件' }}</small>
    </div>
    <div v-if="attachments.length" class="composer-attachments">
      <div v-for="item in attachments" :key="item.id" class="attachment-card">
        <img v-if="item.kind === 'image'" :src="item.dataUrl" :alt="item.name" />
        <span v-else class="attachment-file-icon">{{ item.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE' }}</span>
        <span class="attachment-meta"><strong>{{ item.name }}</strong><small>{{ formatSize(item.size) }}</small></span>
        <a-button type="text" shape="circle" title="移除附件" @click="removeAttachment(item.id)">×</a-button>
      </div>
    </div>
    <EditorContent :editor="editor" />
    <div v-if="command" class="composer-command-menu">
      <div class="command-menu-head">
        <strong>{{ commandMeta[command.trigger].title }}</strong>
        <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>
      <div v-if="suggestions.length" class="command-menu-list">
        <button v-for="(item, index) in suggestions" :key="item.id" type="button" :class="{ active: index === activeIndex }" @mouseenter="activeIndex = index" @mousedown.prevent="selectSuggestion(item)">
          <span class="command-icon">{{ item.icon }}</span>
          <span><strong>{{ item.label }}</strong><small>{{ item.group ? `${item.group} · ` : "" }}{{ item.description }}</small></span>
        </button>
      </div>
      <div v-else class="command-empty">{{ commandMeta[command.trigger].empty }}</div>
    </div>
    <div class="rich-editor-status">
      <label v-if="showAttachments" class="attachment-picker" :class="{ disabled: !supportsFiles && !supportsImages }" :title="supportsImages ? '添加图片或文本文件' : '当前模型仅支持文本文件'">
        <span>＋</span>
        <input type="file" multiple :accept="supportsImages ? 'image/*,.md,.txt,.csv,.json,.yaml,.yml,.xml,.log,.js,.ts,.vue,.py,.sql' : '.md,.txt,.csv,.json,.yaml,.yml,.xml,.log,.js,.ts,.vue,.py,.sql'" :disabled="!supportsFiles && !supportsImages" @change="pickAttachments" />
      </label>
      <span><b>@</b> 角色　<b>#</b> 股票　<b>/</b> 技能与插件</span>
      <span v-if="showSubmit" class="editor-key-hint">Enter 发送 · Shift+Enter 换行</span>
      <a-button v-if="showSubmit" class="rich-send-button" type="primary" shape="circle" :loading="loading" :disabled="disabled || !canSubmit" :aria-label="loading ? '生成中' : '发送消息'" @click="emit('submit')">↑</a-button>
    </div>
  </div>
</template>
