import type { DetailedHTMLProps, HTMLAttributes } from "react";

type MdElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  disabled?: boolean;
  href?: string;
  name?: string;
  type?: string;
  value?: string;
  label?: string;
  required?: boolean;
  autocomplete?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-filled-button": MdElementProps;
      "md-outlined-button": MdElementProps;
      "md-outlined-text-field": MdElementProps;
      "md-elevation": MdElementProps;
    }
  }
}

export {};
