"use client";

import { useId, useState } from "react";

export type TypeaheadOption = { value: string; label: string };

export default function Typeahead({ label, name, options, initialValue = "", value, onChange, required = true, placeholder = "Type to find…" }: { label: string; name?: string; options: TypeaheadOption[]; initialValue?: string; value?: string; onChange?: (value: string) => void; required?: boolean; placeholder?: string }) {
  const id = useId();
  const selectedOption = options.find(option => option.value === (value ?? initialValue));
  const [text, setText] = useState(selectedOption?.label ?? value ?? initialValue);
  const selectedValue = options.find(option => option.label === text)?.value ?? "";
  return <label>{label}<input list={id} value={text} placeholder={placeholder} autoComplete="off" required={required} aria-required={required} onChange={event => { event.currentTarget.setCustomValidity(""); setText(event.target.value); onChange?.(options.find(option => option.label === event.target.value)?.value ?? ""); }} onBlur={event => event.currentTarget.setCustomValidity(!required && !text ? "" : options.some(option => option.label === text) ? "" : "Choose an existing option from the list.")} /><datalist id={id}>{options.map(option => <option key={option.value} value={option.label} />)}</datalist>{name && <input type="hidden" name={name} value={selectedValue} required={required} />}</label>;
}
