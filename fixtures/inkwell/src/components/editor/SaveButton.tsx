"use client";

interface SaveButtonProps {
  onSave: () => void;
  saving?: boolean;
}

export function SaveButton({ onSave, saving = false }: SaveButtonProps) {
  return (
    <button type="button" className="primary" disabled={saving} onClick={onSave}>
      Save
    </button>
  );
}
