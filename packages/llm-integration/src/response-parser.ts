// ============================================================================
// Response Parser - 响应解析器
// ============================================================================

import type { LLMResponse, ToolCall } from './provider-interface.js';

/** 代码块 */
export interface CodeBlock {
  language: string;
  code: string;
  startIndex: number;
  endIndex: number;
}

/** 引用 */
export interface Citation {
  source: string;
  context: string;
  index: number;
}

export class ResponseParser {
  /** 提取文本内容 */
  extractContent(response: LLMResponse): string {
    return response.content ?? '';
  }

  /** 提取工具调用 */
  extractToolCalls(response: LLMResponse): ToolCall[] {
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return [];
    }

    return response.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    }));
  }

  /** 从响应中提取 JSON */
  extractJSON(response: LLMResponse): unknown {
    const content = response.content;

    // 尝试 1: 直接解析整个内容
    try {
      return JSON.parse(content);
    } catch {
      // 继续尝试其他方法
    }

    // 尝试 2: 从 markdown 代码块中提取
    const codeBlocks = this.extractCodeBlocks(response);
    for (const block of codeBlocks) {
      if (block.language === 'json' || block.language === 'JSON') {
        try {
          return JSON.parse(block.code);
        } catch {
          continue;
        }
      }
    }

    // 尝试 3: 查找内容中的 JSON 对象
    const jsonPatterns = [
      /\{[\s\S]*?\}/g,  // JSON 对象 (non-greedy)
      /\[[\s\S]*?\]/g,  // JSON 数组 (non-greedy)
    ];

    for (const pattern of jsonPatterns) {
      const match = pattern.exec(content);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          continue;
        }
      }
    }

    throw new Error('No valid JSON found in response');
  }

  /** 提取代码块 */
  extractCodeBlocks(response: LLMResponse): CodeBlock[] {
    const content = response.content;
    const blocks: CodeBlock[] = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }

    return blocks;
  }

  /** 提取引用 */
  extractCitations(response: LLMResponse): Citation[] {
    const content = response.content;
    const citations: Citation[] = [];

    // 模式 1: [1], [2] 等引用标记
    const bracketPattern = /\[(\d+)\]\s*([^[\]]*)/g;
    let match;
    while ((match = bracketPattern.exec(content)) !== null) {
      citations.push({
        source: match[1],
        context: match[2].trim().slice(0, 200),
        index: match.index,
      });
    }

    // 模式 2: (Source: xxx) 格式
    const sourcePattern = /\(Source:\s*([^)]+)\)/g;
    while ((match = sourcePattern.exec(content)) !== null) {
      citations.push({
        source: match[1].trim(),
        context: '',
        index: match.index,
      });
    }

    // 模式 3: 【引用】 格式
    const chinesePattern = /【([^】]+)】/g;
    while ((match = chinesePattern.exec(content)) !== null) {
      citations.push({
        source: match[1].trim(),
        context: '',
        index: match.index,
      });
    }

    return citations;
  }

  /** 提取纯文本（移除 markdown 格式） */
  extractPlainText(response: LLMResponse): string {
    let content = response.content;

    // 移除代码块
    content = content.replace(/```[\s\S]*?```/g, '');

    // 移除行内代码
    content = content.replace(/`([^`]+)`/g, '$1');

    // 移除粗体/斜体
    content = content.replace(/\*\*([^*]+)\*\*/g, '$1');
    content = content.replace(/\*([^*]+)\*/g, '$1');

    // 移除标题标记
    content = content.replace(/^#{1,6}\s+/gm, '');

    // 移除链接
    content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // 移除多余空白
    content = content.replace(/\n{3,}/g, '\n\n');
    content = content.trim();

    return content;
  }

  /** 检查响应是否包含工具调用 */
  hasToolCalls(response: LLMResponse): boolean {
    return !!(response.toolCalls && response.toolCalls.length > 0);
  }

  /** 检查响应是否完成 */
  isComplete(response: LLMResponse): boolean {
    return response.finishReason === 'stop' || response.finishReason === 'end_turn';
  }

  /** 检查响应是否因 token 限制而截断 */
  isTruncated(response: LLMResponse): boolean {
    return response.finishReason === 'length' || response.finishReason === 'max_tokens';
  }

  /** 提取列表项 */
  extractListItems(response: LLMResponse): string[] {
    const content = response.content;
    const items: string[] = [];

    // 无序列表
    const unorderedPattern = /^[-*+]\s+(.+)$/gm;
    let match;
    while ((match = unorderedPattern.exec(content)) !== null) {
      items.push(match[1].trim());
    }

    // 有序列表
    const orderedPattern = /^\d+\.\s+(.+)$/gm;
    while ((match = orderedPattern.exec(content)) !== null) {
      items.push(match[1].trim());
    }

    return items;
  }

  /** 提取标题 */
  extractHeadings(response: LLMResponse): Array<{ level: number; text: string }> {
    const content = response.content;
    const headings: Array<{ level: number; text: string }> = [];
    const pattern = /^(#{1,6})\s+(.+)$/gm;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      });
    }

    return headings;
  }
}
