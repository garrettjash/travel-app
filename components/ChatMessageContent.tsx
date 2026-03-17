import { Fragment, ReactNode } from "react";

type ListKind = "ol" | "ul";
type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; kind: ListKind; items: string[] };

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }

    parts.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

function renderLines(lines: string[]) {
  return lines.map((line, lineIndex) => (
    <Fragment key={`line-${lineIndex}`}>
      {renderInline(line)}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

function parseBlocks(content: string): Block[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];
  let activeList: { kind: ListKind; items: string[] } | null = null;
  let pendingListBreak = false;
  const appendToActiveListItem = (line: string) => {
    if (!activeList || activeList.items.length === 0) return false;
    activeList.items[activeList.items.length - 1] += `\n${line.trim()}`;
    pendingListBreak = false;
    return true;
  };

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", lines: paragraphLines });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!activeList) return;
    blocks.push({ type: "list", kind: activeList.kind, items: activeList.items });
    activeList = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmedStart = line.trimStart();

    if (!line.trim()) {
      flushParagraph();
      if (activeList) {
        pendingListBreak = true;
        continue;
      }
      continue;
    }

    if (/^\s+/.test(rawLine) && appendToActiveListItem(trimmedStart)) {
      continue;
    }

    if (pendingListBreak && activeList) {
      const continuingOrderedItem = activeList.kind === "ol" && /^\d+\.\s+/.test(trimmedStart);
      const continuingUnorderedItem = activeList.kind === "ul" && /^[-*]\s+/.test(trimmedStart);
      if (!continuingOrderedItem && !continuingUnorderedItem) {
        flushList();
      }
      pendingListBreak = false;
    }

    const headingMatch = trimmedStart.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2]
      });
      continue;
    }

    const orderedItemMatch = trimmedStart.match(/^\d+\.\s+(.*)$/);
    if (orderedItemMatch) {
      flushParagraph();
      if (!activeList || activeList.kind !== "ol") {
        flushList();
        activeList = { kind: "ol", items: [] };
      }
      activeList.items.push(orderedItemMatch[1]);
      continue;
    }

    const unorderedItemMatch = trimmedStart.match(/^[-*]\s+(.*)$/);
    if (unorderedItemMatch) {
      flushParagraph();
      if (!activeList || activeList.kind !== "ul") {
        flushList();
        activeList = { kind: "ul", items: [] };
      }
      activeList.items.push(unorderedItemMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

export default function ChatMessageContent({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return <p>{content}</p>;
  }

  return (
    <div className="chat-message-content">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          if (block.level === 1) return <h1 key={blockIndex}>{renderInline(block.text)}</h1>;
          if (block.level === 2) return <h2 key={blockIndex}>{renderInline(block.text)}</h2>;
          if (block.level === 3) return <h3 key={blockIndex}>{renderInline(block.text)}</h3>;
          if (block.level === 4) return <h4 key={blockIndex}>{renderInline(block.text)}</h4>;
          if (block.level === 5) return <h5 key={blockIndex}>{renderInline(block.text)}</h5>;
          return <h6 key={blockIndex}>{renderInline(block.text)}</h6>;
        }

        if (block.type === "list") {
          const ListTag = block.kind;
          return (
            <ListTag key={blockIndex}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderLines(item.split("\n"))}</li>
              ))}
            </ListTag>
          );
        }

        return <p key={blockIndex}>{renderLines(block.lines)}</p>;
      })}
    </div>
  );
}
