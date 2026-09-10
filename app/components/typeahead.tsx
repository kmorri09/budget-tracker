"use client";

import { useEffect, useId, useRef, useState } from "react";

export type TypeaheadOption = { value: string; label: string };

export default function Typeahead({ label, name, options, initialValue = "", value, onChange, required = true, placeholder = "Type to find…" }: { label: string; name?: string; options: TypeaheadOption[]; initialValue?: string; value?: string; onChange?: (value: string) => void; required?: boolean; placeholder?: string }) {
  const id = useId();
  const root = useRef<HTMLLabelElement>(null);
  const selectedOption = options.find(option => option.value === (value ?? initialValue));
  const [text, setText] = useState(selectedOption?.label ?? value ?? initialValue);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedValue = options.find(option => option.label === text)?.value ?? "";
  const query = text.trim().toLocaleLowerCase();
  const visibleOptions = showAll || !query ? options : options.filter(option => option.label.toLocaleLowerCase().includes(query));

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  function selectOption(index: number) {
    const option = visibleOptions[index];
    if (!option) return;
    setText(option.label); setShowAll(true); setActiveIndex(-1); setOpen(false); onChange?.(option.value);
  }

  return <label ref={root} className="typeahead-field">{label}<span className="typeahead-control"><input id={id + "-input"} value={text} placeholder={placeholder} autoComplete="off" required={required} aria-required={required} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id + "-options"} aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} onFocus={event => { event.currentTarget.select(); setShowAll(true); setOpen(true); }} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex(current => Math.min(visibleOptions.length - 1, current + 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex(current => Math.max(0, current < 0 ? visibleOptions.length - 1 : current - 1)); } else if (event.key === "Enter" && open && activeIndex >= 0) { event.preventDefault(); selectOption(activeIndex); } else if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); } }} onChange={event => { event.currentTarget.setCustomValidity(""); setText(event.target.value); setShowAll(false); setActiveIndex(-1); setOpen(true); onChange?.(options.find(option => option.label === event.target.value)?.value ?? ""); }} onBlur={event => { event.currentTarget.setCustomValidity(!required && !text ? "" : options.some(option => option.label === text) ? "" : "Choose an existing option from the list."); window.setTimeout(() => { if (!root.current?.contains(document.activeElement)) { setOpen(false); setActiveIndex(-1); } }, 0); }} /><button type="button" className="typeahead-toggle" aria-label={`Show all ${label.toLowerCase()} options`} aria-expanded={open && showAll} onMouseDown={event => event.preventDefault()} onClick={() => { if (open && showAll) { setOpen(false); } else { setShowAll(true); setOpen(true); } setActiveIndex(-1); }}><span className="typeahead-chevron" aria-hidden="true" /></button>{open && <div id={id + "-options"} className="typeahead-options" role="listbox">{visibleOptions.map((option, index) => <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={option.label === text} className={option.label === text ? "active" : ""} key={option.value} onMouseDown={event => event.preventDefault()} onClick={() => selectOption(index)}>{option.label}</button>)}{!visibleOptions.length && <span className="typeahead-empty">No matching options</span>}</div>}</span>{name && <input type="hidden" name={name} value={selectedValue} required={required} />}</label>;
}
