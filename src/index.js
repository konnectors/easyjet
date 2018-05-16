// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://52163b1dbb5d4135919ebd3eed6263f4:9f208155dac749d2b3a9de7e24208b22@sentry.cozycloud.cc/42'

const {
  BaseKonnector,
  requestFactory,
  scrape,
  saveBills,
  errors,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: true
  cheerio: true,
  json: false,
  jar: true
})
const moment = require('moment')
const pdf = require('pdfjs')
const html2pdf = require('./html2pdf')
const helveticaFont = new pdf.Font(require('pdfjs/font/Helvetica.json'))
const helveticaBoldFont = new pdf.Font(
  require('pdfjs/font/Helvetica-Bold.json')
)

const baseUrl = 'https://www.easyjet.com'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of reservations')
  const $ = await fetchAllReservations()
  log('info', 'Parsing list of reservations')
  const reservations = parseReservationsList($)

  log('info', 'Fetching reservations details')
  const documents = []
  for (const reservation of reservations) {
    documents.push(await fetchAndParseDetails(reservation))
  }

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: 'easyjet',
    contentType: 'application/pdf'
  })
}

async function fetchAndParseDetails(reservation) {
  const $ = await request({
    method: 'POST',
    url: `${baseUrl}/FR/secure/MyEasyJet.mvc/ViewBooking?bookingReference=${
      reservation.bookingRef
    }`,
    timeout: 1000
  })
  const details = scrape($('article'), {
    title: 'header > div > h1',
    date: {
      sel: '.yourPaymentDescription',
      parse: text => moment(text.trim().split(' ')[0], 'DD/MM/YYYY').toDate()
    },
    amount: {
      sel: '.totalAmount.yourPaymentAmount',
      parse: amount => parseFloat(amount.replace(' €', '').replace(',', '.'))
    }
  })

  return {
    ...reservation,
    ...details,
    vendor: 'easyJet',
    currency: '€',
    filename: `${moment(details.date).format('YYYY-MM')}-${
      reservation.bookingRef
    }-${String(details.amount).replace('.', ',')}€.pdf`,
    filestream: await makePDF(reservation)
  }
}

function parseReservationsList($) {
  return scrape(
    $,
    {
      bookingRef: '.allBookingItemHeaderColumnLeftPast h2'
    },
    '.allBookingItem'
  )
}

function fetchAllReservations() {
  return request({
    url: `${baseUrl}/FR/secure/MyEasyJet.mvc/ShowAllBookingsAjaxCall?sortByMode=FlightDate&showMode=AllFlights&pageIndex=0`,
    timeout: 1000
  })
}

async function authenticate(login, password) {
  // get the cookies
  await request({
    url: `${baseUrl}/fr/`,
    timeout: 1000
  })
  try {
    await request({
      method: 'POST',
      url: `${baseUrl}/ejrebooking/api/v17/account/login`,
      form: {
        Username: login,
        Password: password,
        KeepMeSignedIn: true,
        KeepMeSignedInMinutes: 10080
      },
      resolveWithFullResponse: true,
      timeout: 1000
    })
  } catch (err) {
    if (err.statusCode === 401) {
      throw new Error(errors.LOGIN_FAILED)
    } else {
      throw err
    }
  }
}

async function makePDF(item) {
  const url = `${baseUrl}/FR/secure/BookingConfirmationPrint.mvc/BookingConfirmationPrintReference?bookingNumber=${
    item.bookingRef
  }`
  const $ = await request({
    url,
    timeout: 1000
  })
  var doc = new pdf.Document({ font: helveticaFont })
  makeCell(doc, `Réservation easyJet ${item.bookingRef}:`)
  makeCell(
    doc,
    'Généré automatiquement par le connecteur easyJet depuis la page'
  ).text(`${url}`, {
    link: `${url}`,
    color: '0x0000FF'
  })

  html2pdf($, doc, $('.print'), {
    baseURL: baseUrl,
    filter: $el => {
      return !$el.is('h1')
    }
  })
  doc.end()
  return doc._doc
}

function makeCell(doc, text) {
  return doc
    .cell({ paddingBottom: 0.5 * pdf.cm })
    .text()
    .add(text, { font: helveticaBoldFont, fontSize: 14 })
}
