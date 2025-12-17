import last from "lodash/last";
import sortBy from "lodash/sortBy";
import { v4 as uuidv4 } from "uuid";
import { Node } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { isCode } from "../lib/isCode";
import { isRemoteTransaction } from "../lib/multiplayer";
import { findBlockNodes } from "../queries/findChildren";
import { NodeWithPos } from "../types";
import type { Editor } from "../../../app/editor";
import { LightboxImageFactory } from "../lib/Lightbox";
import pako from "pako";

type PlantUMLState = {
  decorationSet: DecorationSet;
  isDark: boolean;
};

class Cache {
  static get(key: string) {
    return this.data.get(key);
  }

  static set(key: string, value: string) {
    this.data.set(key, value);

    if (this.data.size > this.maxSize) {
      this.data.delete(this.data.keys().next().value);
    }
  }

  private static maxSize = 20;
  private static data: Map<string, string> = new Map();
}

/**
 * Encode PlantUML text for use with the PlantUML server.
 * Uses raw deflate compression and a custom base64-like encoding.
 * See: https://plantuml.com/text-encoding
 */
function encodePlantUML(text: string): string {
  // Convert text to UTF-8 bytes
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(text);

  // Compress using raw deflate (no zlib header)
  const compressed = pako.deflateRaw(utf8Bytes, { level: 9 });

  return encode64(compressed);
}

/**
 * PlantUML uses a custom base64-like encoding.
 * Works with Uint8Array from pako.deflate.
 */
function encode64(data: Uint8Array): string {
  let r = "";
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      r += append3bytes(data[i], data[i + 1], 0);
    } else if (i + 1 === data.length) {
      r += append3bytes(data[i], 0, 0);
    } else {
      r += append3bytes(data[i], data[i + 1], data[i + 2]);
    }
  }
  return r;
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

function encode6bit(b: number): string {
  if (b < 10) {
    return String.fromCharCode(48 + b);
  }
  b -= 10;
  if (b < 26) {
    return String.fromCharCode(65 + b);
  }
  b -= 26;
  if (b < 26) {
    return String.fromCharCode(97 + b);
  }
  b -= 26;
  if (b === 0) {
    return "-";
  }
  if (b === 1) {
    return "_";
  }
  return "?";
}

/**
 * Get the PlantUML server URL from environment.
 * For self-hosted deployments, set PLANTUML_SERVER_URL environment variable.
 * Returns undefined if not configured (PlantUML will be disabled).
 */
function getPlantUMLServerUrl(): string | undefined {
  if (
    typeof window !== "undefined" &&
    (window as typeof window & { env?: Record<string, string> }).env
      ?.PLANTUML_SERVER_URL
  ) {
    return (window as typeof window & { env?: Record<string, string> }).env!
      .PLANTUML_SERVER_URL;
  }
  return undefined;
}

class PlantUMLRenderer {
  readonly diagramId: string;
  readonly element: HTMLElement;
  readonly elementId: string;
  readonly editor: Editor;

  constructor(editor: Editor) {
    this.diagramId = uuidv4();
    this.elementId = `plantuml-diagram-wrapper-${this.diagramId}`;
    this.element =
      document.getElementById(this.elementId) || document.createElement("div");
    this.element.id = this.elementId;
    this.element.classList.add("plantuml-diagram-wrapper");
    this.editor = editor;
  }

  render = async (block: { node: Node; pos: number }, isDark: boolean) => {
    const element = this.element;
    const text = block.node.textContent;

    const serverUrl = getPlantUMLServerUrl();
    if (!serverUrl) {
      element.innerText =
        "PlantUML server not configured. Set PLANTUML_SERVER_URL environment variable.";
      element.classList.add("parse-error");
      return;
    }

    const cacheKey = `${isDark ? "dark" : "light"}-${text}`;
    const cache = Cache.get(cacheKey);
    if (cache) {
      element.classList.remove("parse-error", "empty");
      element.innerHTML = cache;
      return;
    }

    const isEmpty = text.trim().length === 0;
    if (isEmpty) {
      element.innerText = "Empty diagram";
      element.classList.add("empty");
      return;
    }

    try {
      // Add dark theme directive if in dark mode
      let diagramText = text;
      if (isDark && !text.includes("!theme")) {
        // Insert dark theme after @startuml if present
        if (text.includes("@startuml")) {
          diagramText = text.replace(/@startuml/, "@startuml\n!theme cyborg");
        } else {
          diagramText = "!theme cyborg\n" + text;
        }
      }

      const encoded = encodePlantUML(diagramText);
      const svgUrl = `${serverUrl}/svg/${encoded}`;

      const response = await fetch(svgUrl);
      if (!response.ok) {
        throw new Error(`Failed to render diagram: ${response.statusText}`);
      }

      const svg = await response.text();

      // Cache the rendered SVG
      if (text) {
        Cache.set(cacheKey, svg);
      }

      element.classList.remove("parse-error", "empty");
      element.innerHTML = svg;
    } catch (error) {
      element.innerText =
        error instanceof Error ? error.message : String(error);
      element.classList.add("parse-error");
    }
  };
}

function overlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  return Math.max(0, Math.min(end1, end2) - Math.max(start1, start2));
}

function findBestOverlapDecoration(
  decorations: Decoration[],
  block: NodeWithPos
): Decoration | undefined {
  if (decorations.length === 0) {
    return undefined;
  }
  return last(
    sortBy(decorations, (decoration) =>
      overlap(
        decoration.from,
        decoration.to,
        block.pos,
        block.pos + block.node.nodeSize
      )
    )
  );
}

function getNewState({
  doc,
  name,
  pluginState,
  editor,
}: {
  doc: Node;
  name: string;
  pluginState: PlantUMLState;
  editor: Editor;
}): PlantUMLState {
  const decorations: Decoration[] = [];

  // Find all blocks that represent PlantUML diagrams
  const blocks = findBlockNodes(doc).filter(
    (item) =>
      item.node.type.name === name && item.node.attrs.language === "plantuml"
  );

  blocks.forEach((block) => {
    const existingDecorations = pluginState.decorationSet.find(
      block.pos,
      block.pos + block.node.nodeSize,
      (spec) => !!spec.diagramId
    );

    const bestDecoration = findBestOverlapDecoration(
      existingDecorations,
      block
    );

    const renderer: PlantUMLRenderer =
      bestDecoration?.spec?.renderer ?? new PlantUMLRenderer(editor);

    const diagramDecoration = Decoration.widget(
      block.pos + block.node.nodeSize,
      () => {
        void renderer.render(block, pluginState.isDark);
        return renderer.element;
      },
      {
        diagramId: renderer.diagramId,
        renderer,
        side: -10,
      }
    );

    const diagramIdDecoration = Decoration.node(
      block.pos,
      block.pos + block.node.nodeSize,
      {},
      {
        diagramId: renderer.diagramId,
        renderer,
      }
    );

    decorations.push(diagramDecoration);
    decorations.push(diagramIdDecoration);
  });

  return {
    decorationSet: DecorationSet.create(doc, decorations),
    isDark: pluginState.isDark,
  };
}

export default function PlantUML({
  name,
  isDark,
  editor,
}: {
  name: string;
  isDark: boolean;
  editor: Editor;
}) {
  return new Plugin({
    key: new PluginKey("plantuml"),
    state: {
      init: (_, { doc }) => {
        const pluginState: PlantUMLState = {
          decorationSet: DecorationSet.create(doc, []),
          isDark,
        };
        return getNewState({
          doc,
          name,
          pluginState,
          editor,
        });
      },
      apply: (
        transaction: Transaction,
        pluginState: PlantUMLState,
        oldState,
        state
      ) => {
        const nodeName = state.selection.$head.parent.type.name;
        const previousNodeName = oldState.selection.$head.parent.type.name;
        const codeBlockChanged =
          transaction.docChanged && [nodeName, previousNodeName].includes(name);
        const themeMeta = transaction.getMeta("theme");
        const plantumlMeta = transaction.getMeta("plantuml");
        const themeToggled = themeMeta?.isDark !== undefined;

        if (themeToggled) {
          pluginState.isDark = themeMeta.isDark;
        }

        if (
          plantumlMeta ||
          themeToggled ||
          codeBlockChanged ||
          isRemoteTransaction(transaction)
        ) {
          return getNewState({
            doc: transaction.doc,
            name,
            pluginState,
            editor,
          });
        }

        return {
          decorationSet: pluginState.decorationSet.map(
            transaction.mapping,
            transaction.doc
          ),
          isDark: pluginState.isDark,
        };
      },
    },
    view: (view) => {
      view.dispatch(view.state.tr.setMeta("plantuml", { loaded: true }));
      return {};
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorationSet;
      },
      handleDOMEvents: {
        mouseup(view, event) {
          const target = event.target as HTMLElement;
          const diagram = target?.closest(".plantuml-diagram-wrapper");
          const codeBlock = diagram?.previousElementSibling;

          if (!codeBlock) {
            return false;
          }

          const pos = view.posAtDOM(codeBlock, 0);
          if (!pos) {
            return false;
          }

          if (diagram && event.detail === 1) {
            const { selection: textSelection } = view.state;
            const $pos = view.state.doc.resolve(pos);
            const selected =
              textSelection.from >= $pos.start() &&
              textSelection.to <= $pos.end();
            if (selected || editor.props.readOnly) {
              editor.updateActiveLightboxImage(
                LightboxImageFactory.createLightboxImage(view, $pos.before())
              );
              return true;
            }

            // select node
            view.dispatch(
              view.state.tr
                .setSelection(TextSelection.near(view.state.doc.resolve(pos)))
                .scrollIntoView()
            );
            return true;
          }

          return false;
        },
        keydown: (view, event) => {
          switch (event.key) {
            case "ArrowDown": {
              const { selection } = view.state;
              const $pos = view.state.doc.resolve(
                Math.min(selection.from + 1, view.state.doc.nodeSize)
              );
              const nextBlock = $pos.nodeAfter;

              if (
                nextBlock &&
                isCode(nextBlock) &&
                nextBlock.attrs.language === "plantuml"
              ) {
                view.dispatch(
                  view.state.tr
                    .setSelection(
                      TextSelection.near(
                        view.state.doc.resolve(selection.to + 1)
                      )
                    )
                    .scrollIntoView()
                );
                event.preventDefault();
                return true;
              }
              return false;
            }
            case "ArrowUp": {
              const { selection } = view.state;
              const $pos = view.state.doc.resolve(
                Math.max(0, selection.from - 1)
              );
              const prevBlock = $pos.nodeBefore;

              if (
                prevBlock &&
                isCode(prevBlock) &&
                prevBlock.attrs.language === "plantuml"
              ) {
                view.dispatch(
                  view.state.tr
                    .setSelection(
                      TextSelection.near(
                        view.state.doc.resolve(selection.from - 2)
                      )
                    )
                    .scrollIntoView()
                );
                event.preventDefault();
                return true;
              }
              return false;
            }
          }

          return false;
        },
      },
    },
  });
}
