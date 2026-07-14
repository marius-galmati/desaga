import styles from "./stepper.module.css";

const STEPS = ["Preparat", "Referințe", "Evaluare"] as const;
const NUMERALS = ["I", "II", "III"] as const;

export function Stepper({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className={styles.steps}>
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={label} className={styles.step} data-state={state}>
            <span className={styles.numeral}>{NUMERALS[i]}</span>
            <span className={styles.label}>{label}</span>
            {i < STEPS.length - 1 ? <span className={styles.rule} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
