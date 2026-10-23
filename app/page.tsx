import Image from 'next/image';
import {
  ArrowDown,
  ArrowUpRight,
  CalendarDays,
  MapPin,
  MessageCircle,
} from 'lucide-react';
import { ReelShowcase } from '@/components/reel-showcase';

const pastEvents = [
  {
    date: '26 Apr 2026',
    dateTime: '2026-04-26',
    title: 'Inaugural Codex Community Hackathon',
    place: 'Jain University, Kochi',
    note: 'A full day of building, five finalist teams, and three winning ideas.',
    image: '/events/april-hackathon.jpg',
    href: 'https://www.instagram.com/p/DX4mUIvkl_a/',
    accent: 'april',
  },
  {
    date: '06—07 Jun 2026',
    dateTime: '2026-06-06',
    title: 'Codex Community Hackathon',
    place: 'TinkerSpace, Kalamassery',
    note: 'An overnight build with about 45 makers, from 8 PM to sunrise.',
    image: '/events/june-overnight.webp',
    href: 'https://www.instagram.com/p/DYwzSlGS3Pm/',
    accent: 'overnight',
  },
  {
    date: '27 Jun 2026',
    dateTime: '2026-06-27',
    title: 'Codex Community Meetup',
    place: 'RECCAA Club, Thrikkakara',
    note: 'Hands-on sessions, live demos, and generous conversations between builders.',
    image: '/events/reccaa-meetup.jpg',
    href: 'https://www.instagram.com/p/DZw6AhWy7X8/',
    accent: 'reccaa',
  },
  {
    date: '28 Jul 2026',
    dateTime: '2026-07-28',
    title: 'Codex Community Meetup',
    place: 'Jain University, Kochi',
    note: 'Project showcases, practical AI conversations, and another room full of momentum.',
    image: '/events/july-meetup.jpg',
    href: 'https://www.instagram.com/p/DbFcazOi0gM/',
    accent: 'july',
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Codex Kochi home">
          <Image
            className="brand-icon"
            src="/codex-app-icon.png"
            alt=""
            width={42}
            height={42}
            loading="eager"
          />
          <span>Codex Kochi</span>
        </a>

        <nav className="site-nav" aria-label="Primary navigation">
          <a href="#events">Events</a>
          <a href="#watch">Watch</a>
          <a href="#about">About</a>
          <a href="/desk">Build Desk</a>
        </nav>

        <a
          className="header-cta"
          href="https://www.instagram.com/codexkochi/"
          target="_blank"
          rel="noreferrer"
        >
          @codexkochi
          <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
        </a>
      </header>

      <section className="hero" id="top">
        <div className="codex-aura" aria-hidden="true" />

        <div className="hero-center">
          <Image
            className="hero-icon"
            src="/codex-app-icon.png"
            alt="Codex"
            width={124}
            height={124}
            preload
          />
          <p className="eyebrow">OpenAI Codex ambassador-led community</p>
          <h1>Codex Kochi</h1>
          <p className="hero-intro">
            Kerala&apos;s hands-on community for people who would rather build
            the future than wait for it.
          </p>
          <div className="hero-actions">
            <a className="button button-dark" href="#events">
              Explore the event log
              <ArrowDown aria-hidden="true" size={16} />
            </a>
            <a
              className="button button-glass"
              href="https://www.instagram.com/codexkochi/"
              target="_blank"
              rel="noreferrer"
            >
              Follow the community
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </div>
        </div>

        <div className="hero-foot">
          <span>Kochi, Kerala</span>
          <span>Established March 2026</span>
          <span>Scroll to explore&nbsp; ↓</span>
        </div>
      </section>

      <section className="intro shell" id="about">
        <div className="section-kicker">
          <span>01</span>
          <p>The community</p>
        </div>
        <div className="intro-copy">
          <h2>
            Built here.
            <br />
            Shared <span>everywhere.</span>
          </h2>
          <div>
            <p>
              Codex Kochi brings developers, designers, students, and curious
              minds into the same room to learn by making. Some builds last a
              day. Some last all night. One happened on a moving Metro train.
            </p>
            <p>
              The format changes. The idea does not: show up curious, build
              something real, and leave the room more capable than you entered.
            </p>
          </div>
        </div>
        <div className="signal-row" aria-label="Community at a glance">
          <div>
            <strong>05</strong>
            <span>events in the log</span>
          </div>
          <div>
            <strong>01</strong>
            <span>moving build sprint</span>
          </div>
          <div>
            <strong>∞</strong>
            <span>reasons to start</span>
          </div>
        </div>
      </section>

      <section className="events shell" id="events">
        <div className="section-kicker">
          <span>02</span>
          <p>The event log</p>
        </div>

        <div className="section-title-row">
          <h2>A community measured in things made.</h2>
          <p>
            From day-long hackathons to after-hours experiments, this is the
            story so far.
          </p>
        </div>

        <article className="nightline-feature">
          <div className="nightline-image">
            <Image
              src="/events/nightline-onboard.webp"
              alt="Builders working on laptops aboard the Kochi Metro during Codex Nightline"
              fill
              sizes="(max-width: 900px) 100vw, 58vw"
            />
            <div className="image-label">A world-first format</div>
          </div>
          <div className="nightline-copy">
            <div className="event-meta">
              <time dateTime="2026-07-18">18 Jul 2026</time>
              <span>Past event</span>
            </div>
            <p className="event-number">05 / Codex Nightline</p>
            <h3>The deadline moved. So did we.</h3>
            <p>
              One hundred solo builders boarded Kochi Metro after hours for a
              two-hour AI sprint from Vyttila to Aluva, through Thrippunithura,
              and back. Ideas were built, tested, and shared before the doors
              opened again.
            </p>
            <div className="nightline-route" aria-label="Nightline route">
              <span>Vyttila</span>
              <i />
              <span>Aluva</span>
              <i />
              <span>Thrippunithura</span>
              <i />
              <span>Vyttila</span>
            </div>
            <a
              className="text-link"
              href="https://www.codexnightline.in/"
              target="_blank"
              rel="noreferrer"
            >
              Relive Codex Nightline
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </div>
        </article>

        <div className="event-grid">
          {pastEvents.map((event, index) => (
            <article
              className={`event-card ${event.accent}`}
              key={event.title + event.date}
            >
              <a
                className="event-image"
                href={event.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${event.title} on Instagram`}
              >
                <Image
                  src={event.image}
                  alt={`${event.title} event visual`}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1180px) 38vw, 25vw"
                />
                <span className="event-index">0{index + 1}</span>
              </a>
              <div className="event-card-copy">
                <div className="event-meta">
                  <time dateTime={event.dateTime}>{event.date}</time>
                  <span>Past event</span>
                </div>
                <h3>{event.title}</h3>
                <p className="event-place">
                  <MapPin aria-hidden="true" size={15} />
                  {event.place}
                </p>
                <p>{event.note}</p>
                <a
                  className="text-link"
                  href={event.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  View event on Instagram
                  <ArrowUpRight aria-hidden="true" size={15} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="watch" id="watch">
        <div className="shell watch-inner">
          <div className="section-kicker section-kicker-light">
            <span>03</span>
            <p>Watch it happen</p>
          </div>
          <div className="watch-heading">
            <h2>Two nights. No spectators.</h2>
            <div className="watch-deck">
              <p>
                One room stayed awake until sunrise. Another moved across the
                city. Both were full of people making something real.
              </p>
              <span>
                <i /> 02 highlight films
              </span>
            </div>
          </div>
          <ReelShowcase />
        </div>
      </section>

      <section className="next-build shell">
        <div className="section-kicker">
          <span>04</span>
          <p>Next build</p>
        </div>
        <div className="next-card">
          <div className="next-visual">
            <Image
              src="/events/calicut-hackathon.jpg"
              alt="Codex Community Hackathon Calicut poster"
              fill
              sizes="(max-width: 900px) 100vw, 44vw"
            />
          </div>
          <div className="next-copy">
            <p className="status-pill">
              <span /> Upcoming
            </p>
            <p className="next-eyebrow">Next stop / Calicut</p>
            <h2>An all-nighter for 50 solo builders.</h2>
            <p>
              Fourteen hours to go from blank page to working prototype, with
              API credits, ChatGPT Pro, mentors, food, and a room built for
              focus.
            </p>
            <div className="next-facts">
              <span>
                <CalendarDays aria-hidden="true" size={17} />
                19 Sep, 7:30 PM — 20 Sep, 9:30 AM
              </span>
              <span>
                <MapPin aria-hidden="true" size={17} />
                TinkerSpace, Calicut
              </span>
            </div>
            <div className="next-actions">
              <a
                className="button button-dark"
                href="https://luma.com/l5tpblw3"
                target="_blank"
                rel="noreferrer"
              >
                View event details
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
              <a
                className="text-link"
                href="https://www.instagram.com/p/DcjY4hvyB_d/"
                target="_blank"
                rel="noreferrer"
              >
                Instagram post
                <ArrowUpRight aria-hidden="true" size={15} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="join" id="join">
        <Image
          className="join-icon"
          src="/codex-app-icon.png"
          alt=""
          width={92}
          height={92}
        />
        <p className="eyebrow">There is room for what you are building</p>
        <h2>Bring the unfinished thing.</h2>
        <p>
          Meet people who will ask better questions, share what they know, and
          help you get the idea out of your notes.
        </p>
        <div className="hero-actions">
          <a
            className="button button-dark"
            href="https://wa.me/917907649864"
            target="_blank"
            rel="noreferrer"
          >
            Join the WhatsApp community
            <MessageCircle aria-hidden="true" size={16} />
          </a>
          <a
            className="button button-glass"
            href="https://www.instagram.com/codexkochi/"
            target="_blank"
            rel="noreferrer"
          >
            Follow on Instagram
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </div>
      </section>

      <footer className="site-footer shell">
        <div className="footer-brand">
          <Image src="/codex-app-icon.png" alt="" width={48} height={48} />
          <div>
            <strong>Codex Kochi</strong>
            <span>OpenAI Codex community · Kochi, Kerala</span>
          </div>
        </div>
        <div className="footer-links">
          <a href="#events">Event log</a>
          <a href="#watch">Highlights</a>
          <a
            href="https://www.instagram.com/codexkochi/"
            target="_blank"
            rel="noreferrer"
          >
            Instagram <ArrowUpRight aria-hidden="true" size={13} />
          </a>
        </div>
        <p className="footer-note">
          Community-led by Vaishakh Suresh · OpenAI Codex Ambassador
        </p>
      </footer>
    </main>
  );
}
