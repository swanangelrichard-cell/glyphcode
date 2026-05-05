import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef } from "react";

type WordGridInputProps = {
  id?: string;
  value: string;
  onChange: (nextValue: string) => void;
  length: number;
  disabled?: boolean;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
};

const sanitizeWord = (rawWord: string, maxLength: number) =>
  rawWord
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, maxLength);

function WordGridInput({
  id,
  value,
  onChange,
  length,
  disabled = false,
  placeholder,
  onSubmit,
  autoFocus = false,
}: WordGridInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const letters = useMemo(
    () => Array.from({ length }, (_, index) => value[index] ?? ""),
    [length, value],
  );
  const surfaceStyle = useMemo(
    () =>
      ({
        gridTemplateColumns: `repeat(${length}, minmax(40px, 1fr))`,
      }) as CSSProperties,
    [length],
  );

  useEffect(() => {
    const currentInput = inputRef.current;
    if (disabled && currentInput && currentInput === document.activeElement) {
      currentInput.blur();
    }
  }, [disabled]);

  useEffect(() => {
    if (!autoFocus || disabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 25);

    return () => window.clearTimeout(timeoutId);
  }, [autoFocus, disabled]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className={`word-grid-input ${disabled ? "word-grid-input--disabled" : ""}`}>
      <div className="word-grid-input__surface" style={surfaceStyle} aria-hidden="true">
        {letters.map((letter, index) => (
          <span
            key={`${index}-${letter}`}
            className={`word-grid-input__tile ${letter ? "word-grid-input__tile--filled" : ""}`}
          >
            {letter}
          </span>
        ))}
      </div>

      <input
        id={id}
        ref={inputRef}
        className="word-grid-input__native"
        type="text"
        value={value}
        maxLength={length}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        aria-label={placeholder ?? `Mot de ${length} lettres`}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(event) => onChange(sanitizeWord(event.target.value, length))}
      />
    </div>
  );
}

export default WordGridInput;
