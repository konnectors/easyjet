const https = require('https')
const baseUrl = 'https://www.easyjet.com'

console.log('begin')
https
  .get(`${baseUrl}/fr`, resp => {
    let data = ''

    // A chunk of data has been recieved.
    resp.on('data', chunk => {
      // console.log('data')
      data += chunk
    })

    // The whole response has been received. Print out the result.
    resp.on('end', () => {
      console.log('end')
      // console.log(data, 'data')
    })
  })
  .on('error', err => {
    console.log('Error: ' + err.message)
  })
