/**
 * SignatureBlock — Tiptap node that wraps the operator's signature
 * inside the composer body so we can find + replace it when the
 * operator switches the From inbox.
 *
 * Why a custom node instead of HTML comments:
 *   Tiptap (and ProseMirror more broadly) doesn't preserve HTML
 *   comments — they aren't part of any node's schema and get
 *   dropped on parse. The previous execCommand-based editor could
 *   keep them because contenteditable preserves the raw DOM, but
 *   that doesn't generalize. A real node round-trips cleanly.
 *
 * Output HTML:
 *   <div data-composer-signature="true">...the operator's signature...</div>
 *
 * stripSignatureBlock + the swap-signature flow in composer-window
 * match this element instead of the previous <!--composer-signature-->
 * comment markers.
 *
 * Content is block+ so signatures with paragraphs, lists, tables,
 * etc. all render normally. Operators can edit their signature
 * inline; the wrapper just marks the boundary.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface SignatureBlockOptions {
  HTMLAttributes: Record<string, string>;
}

export const SignatureBlock = Node.create<SignatureBlockOptions>({
  name: "signatureBlock",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-composer-signature]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-composer-signature": "true",
      }),
      0,
    ];
  },
});
