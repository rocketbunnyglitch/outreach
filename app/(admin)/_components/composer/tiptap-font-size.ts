/**
 * FontSize — Tiptap extension that adds a font-size attribute to
 * the TextStyle mark, with setFontSize / unsetFontSize commands.
 *
 * Tiptap doesn't ship a font-size extension because Web doesn't
 * have a stable canonical inline-size attribute (the legacy
 * <font size="5"> uses a 1-7 scale that doesn't map to anything
 * the modern CSS engine handles cleanly). We render via inline
 * style="font-size: NN px" on a <span> — the same shape every
 * other Tiptap inline-style extension uses (Color, FontFamily).
 *
 * Operators see a "Small / Normal / Large / Huge" picker rather
 * than raw pixel values; the toolbar component owns the
 * label-to-value mapping.
 *
 * Output HTML when font-size is set:
 *   <span style="font-size: 18px">large text</span>
 *
 * Strips cleanly on send via sanitiseEmailHtml (style attrs on
 * <span> are preserved — they're a normal email-formatting
 * vehicle).
 */

import { Extension } from "@tiptap/core";

export interface FontSizeOptions {
  /** ProseMirror node + mark types the font size can attach to. */
  types: string[];
}

// Augment the Commands map so chain().setFontSize() / unsetFontSize()
// type-check from the consumer.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, "") || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize: size }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
        },
    };
  },
});
