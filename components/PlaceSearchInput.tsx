import { useEffect, useMemo, useRef, useState } from "react";

type PlaceOption = {
  id: number;
  label: string;
  city: string;
  countryRegion: string;
};

type PlaceSearchInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  "aria-label"?: string;
};

export default function PlaceSearchInput({
  id,
  value,
  onChange,
  placeholder = "City or country",
  className = "planning-solo-input",
  required,
  "aria-label": ariaLabel
}: PlaceSearchInputProps) {
  const [placesOptions, setPlacesOptions] = useState<PlaceOption[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setPlacesOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set("search", q);
        const res = await fetch(`/api/collab-places?${params.toString()}`);
        let data: { options?: PlaceOption[]; error?: string } = {};
        try {
          const text = await res.text();
          if (text && text.trim().startsWith("{")) data = JSON.parse(text);
        } catch {
          /* response was not valid JSON (e.g. HTML error page) */
        }
        if (!cancelled && data.options) setPlacesOptions(data.options);
        else if (!cancelled) setPlacesOptions([]);
      } catch {
        if (!cancelled) setPlacesOptions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  const filteredPlaces = useMemo(() => placesOptions.slice(0, 50), [placesOptions]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelectPlace(place: PlaceOption) {
    onChange(place.label);
    setDropdownOpen(false);
  }

  return (
    <div className="planning-place-search-wrapper" ref={dropdownRef}>
      <input
        id={id}
        type="text"
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setDropdownOpen(true)}
        onBlur={() => setTimeout(() => setDropdownOpen(false), 180)}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        aria-label={ariaLabel}
        aria-expanded={dropdownOpen}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        role="combobox"
      />
      {dropdownOpen && (
        <ul
          id={`${id}-listbox`}
          className="saved-trips-place-listbox planning-place-listbox"
          role="listbox"
          aria-label="Available destinations"
        >
          {filteredPlaces.length === 0 ? (
            <li className="saved-trips-place-option saved-trips-place-option-empty" role="option" aria-selected={false}>
              {value.trim() ? "No matching places" : "Type to search destinations…"}
            </li>
          ) : (
            filteredPlaces.map((p) => (
              <li
                key={p.id}
                role="option"
                className="saved-trips-place-option"
                aria-selected={value === p.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectPlace(p);
                }}
              >
                {p.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
