"use client";

import { useState, type FormEvent } from "react";
import { MdFilledButton } from "@/lib/material/md-filled-button";
import {
  FINDING_QUESTION,
  RESULT_OPTIONS,
  RESULT_QUESTION,
  SELECT_PLACEHOLDER,
  SUBMIT_ANSWERS_LABEL,
  TIMING_OPTIONS,
  TIMING_QUESTION,
} from "@/lib/copy/pre-call";

function OutlinedSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="pre-call-field">
      <label className="pre-call-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        data-empty={value === "" ? "true" : "false"}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{SELECT_PLACEHOLDER}</option>
        {options.map((option, index) => (
          <option key={`${index}-${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="pre-call-field-chevron" aria-hidden="true">
        <img
          src="/audit/keyboard-arrow-down.svg"
          alt=""
          width={24}
          height={24}
        />
      </span>
    </div>
  );
}

export function PrepareForm({
  token,
  findingOptions,
  submitUrl = "/api/v1/pre-call-answers",
}: {
  token?: string;
  findingOptions: readonly string[];
  submitUrl?: string;
}) {
  const [findingAnswer, setFindingAnswer] = useState("");
  const [resultAnswer, setResultAnswer] = useState("");
  const [timingAnswer, setTimingAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(token ? { statusToken: token } : {}),
          findingAnswer: findingAnswer || null,
          resultAnswer: resultAnswer || null,
          timingAnswer: timingAnswer || null,
        }),
      });
      const json = (await response.json()) as {
        scheduleUrl?: string;
        error?: string;
      };
      if (!response.ok || !json.scheduleUrl) {
        setError(json.error ?? "Could not save answers.");
        return;
      }
      window.location.assign(json.scheduleUrl);
    } catch {
      setError("Could not save answers.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="pre-call-form" onSubmit={onSubmit} noValidate>
      <OutlinedSelect
        id="finding"
        label={FINDING_QUESTION}
        value={findingAnswer}
        options={findingOptions}
        onChange={setFindingAnswer}
      />
      <OutlinedSelect
        id="result"
        label={RESULT_QUESTION}
        value={resultAnswer}
        options={RESULT_OPTIONS}
        onChange={setResultAnswer}
      />
      <OutlinedSelect
        id="timing"
        label={TIMING_QUESTION}
        value={timingAnswer}
        options={TIMING_OPTIONS}
        onChange={setTimingAnswer}
      />
      <MdFilledButton
        className="pre-call-submit"
        disabled={pending}
        type="submit"
      >
        {pending ? "Submitting…" : SUBMIT_ANSWERS_LABEL}
      </MdFilledButton>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
