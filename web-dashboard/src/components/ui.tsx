import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`field ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`field ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`card ${className}`} {...props} />;
}

export function Tabs({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`tabs ${className}`} {...props} />;
}

export function ModalFrame({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`modal-frame ${className}`} {...props} />;
}

export function Toast({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`toast ${className}`} {...props} />;
}

export function Table({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`table-shell ${className}`} {...props} />;
}
