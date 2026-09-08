import { IntakeForm } from "./intake-form";
import "./landing.css";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="landing">
      <nav className="landing-nav" aria-label="Primary">
        <a className="landing-logo" href="/">
          <span className="landing-logo-mark">
            <img
              src="/landing/logo-mark.svg"
              alt=""
              width={51}
              height={51}
            />
          </span>
          <span className="landing-wordmark">
            <img
              src="/landing/wordmark.svg"
              alt="Booked N Busy"
              width={94}
              height={51}
            />
          </span>
        </a>
        <button className="landing-menu" type="button" aria-label="Open menu">
          <span className="landing-menu-icon">
            <img src="/landing/menu.svg" alt="" width={40} height={40} />
          </span>
        </button>
      </nav>
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-eyebrow">Free Website Performance Audit</p>
          <h1 className="landing-title">
            Is your website helping or hurting your business?
          </h1>
          <p className="landing-subhead">
            Get your speed, security, and SEO grade in seconds
          </p>
          <div className="landing-testimonial">
            <span className="landing-avatar">
              <img
                src="/landing/marcus-white.jpg"
                alt=""
                width={56}
                height={56}
              />
            </span>
            <div className="landing-testimonial-copy">
              <p className="landing-testimonial-name">Marcus White</p>
              <p className="landing-testimonial-role">Founder &amp; CPO</p>
            </div>
          </div>
        </div>
        <IntakeForm />
      </section>
    </main>
  );
}
