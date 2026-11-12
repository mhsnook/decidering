// Refreshes seed/data/us-congress.json from public sources:
//   roster      — github.com/unitedstates/congress-legislators
//   cosponsors  — api.congress.gov (set CONGRESS_API_KEY; DEMO_KEY is heavily rate limited)
import { writeFileSync } from 'node:fs'

const KEY = process.env.CONGRESS_API_KEY ?? 'DEMO_KEY'
const CONGRESS = 119
const BILLS = [
  { id: 'hr3069', type: 'hr', number: 3069, chamber: 'House', label: 'H.R. 3069', path: 'house-bill' },
  { id: 's1506', type: 's', number: 1506, chamber: 'Senate', label: 'S. 1506', path: 'senate-bill' },
]
const NON_VOTING = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP'])

async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url.replace(KEY, '***')}`)
  return res.json()
}

const legislators = await getJson('https://unitedstates.github.io/congress-legislators/legislators-current.json')
const members = legislators.map((l: any) => {
  const term = l.terms.at(-1)
  const senate = term.type === 'sen'
  return {
    bioguide: l.id.bioguide,
    name: l.name.official_full ?? `${l.name.first} ${l.name.last}`,
    sort_name: `${l.name.last}, ${l.name.first}`,
    chamber: senate ? 'Senate' : 'House',
    state: term.state,
    district: senate ? null : term.district,
    senate_class: senate ? term.class : null,
    party: term.party,
    url: term.url ?? null,
    voting: senate || !NON_VOTING.has(term.state),
  }
})

const bills = []
for (const bill of BILLS) {
  const base = `https://api.congress.gov/v3/bill/${CONGRESS}/${bill.type}/${bill.number}`
  const detail = (await getJson(`${base}?api_key=${KEY}&format=json`)).bill
  const cosponsors = (await getJson(`${base}/cosponsors?api_key=${KEY}&format=json&limit=250`)).cosponsors
  bills.push({
    id: bill.id,
    label: bill.label,
    chamber: bill.chamber,
    title: detail.title,
    introduced_on: detail.introducedDate,
    url: `https://www.congress.gov/bill/${CONGRESS}th-congress/${bill.path}/${bill.number}`,
    sponsor: detail.sponsors[0].bioguideId,
    cosponsors: cosponsors
      .filter((c: any) => !c.sponsorshipWithdrawnDate)
      .map((c: any) => ({ bioguide: c.bioguideId, on: c.sponsorshipDate, original: c.isOriginalCosponsor })),
  })
}

const out = { fetched_on: new Date().toISOString().slice(0, 10), members, bills }
writeFileSync(new URL('../seed/data/us-congress.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`${members.length} members; ${bills.map((b) => `${b.label}: ${b.cosponsors.length} cosponsors`).join('; ')}`)
