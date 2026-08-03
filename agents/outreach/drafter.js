function draftOutreach(target) {
  const templates = {
    intro: `Hi ${target.name},

We are TEOS Sentinel Shield — AI security governance platform.

Interested in a partnership conversation?

Best,
Ayman`,
    partnership: `Hi ${target.name},

We built TEOS Sentinel Shield to govern AI systems.

Would you explore a partnership with us?

Best,
Ayman`,
    sponsorship: `Hi ${target.name},

EGD2026 — Multi-city AI hackathon (Sept 15).

We are recruiting sponsors. Interested?

Best,
Ayman`
  };

  return {
    to: target.email,
    subject: 'Partnership: TEOS Sentinel Shield',
    body: templates[target.template || 'intro'],
    target: target.name,
    drafted_at: new Date().toISOString()
  };
}

module.exports = { draftOutreach };
