import net from 'node:net'
import tls from 'node:tls'

function connect(host: string, port: number, secure: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(sock))
      : net.connect({ host, port }, () => resolve(sock))
    sock.once('error', reject)
  })
}

class SmtpSession {
  private buf = ''
  private pending: Array<{ code: number; resolve: (s: string) => void; reject: (e: Error) => void }> = []

  constructor(private sock: net.Socket) {
    sock.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString('utf8')
      this.flush()
    })
  }

  private flush(): void {
    const parts = this.buf.split(/\r?\n/)
    this.buf = parts.pop() || ''
    for (const line of parts) {
      const m = /^(\d{3})([ -])(.*)$/.exec(line)
      if (!m || m[2] === '-') continue
      const got = Number(m[1])
      const job = this.pending.shift()
      if (!job) continue
      if (got !== job.code) job.reject(new Error(`SMTP ${got}: ${m[3]}`))
      else job.resolve(m[3])
    }
  }

  wait(code: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending.push({ code, resolve, reject })
      this.flush()
    })
  }

  send(line: string): void {
    this.sock.write(line + '\r\n')
  }

  end(): void {
    this.sock.end()
  }

  upgrade(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tlsSock = tls.connect({ socket: this.sock, servername: host }, () => {
        this.sock = tlsSock
        resolve()
      })
      tlsSock.once('error', reject)
    })
  }
}

export async function sendSmtpMail(opts: { to: string; subject: string; text: string }): Promise<void> {
  const host = process.env.SMTP_HOST || ''
  const port = Number(process.env.SMTP_PORT || 465)
  const user = process.env.SMTP_USER || ''
  const pass = process.env.SMTP_PASS || ''
  const from = process.env.SMTP_FROM || user
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== '0' : port === 465
  if (!host || !user || !pass || !from) throw new Error('未配置 SMTP')

  const sock = await connect(host, port, secure)
  const smtp = new SmtpSession(sock)
  await smtp.wait(220)
  smtp.send(`EHLO ${host}`)
  await smtp.wait(250)
  if (!secure && port === 587) {
    smtp.send('STARTTLS')
    await smtp.wait(220)
    await smtp.upgrade(host)
    smtp.send(`EHLO ${host}`)
    await smtp.wait(250)
  }
  smtp.send('AUTH LOGIN')
  await smtp.wait(334)
  smtp.send(Buffer.from(user).toString('base64'))
  await smtp.wait(334)
  smtp.send(Buffer.from(pass).toString('base64'))
  await smtp.wait(235)
  const fromAddr = /<([^>]+)>/.exec(from)?.[1] || from
  smtp.send(`MAIL FROM:<${fromAddr}>`)
  await smtp.wait(250)
  smtp.send(`RCPT TO:<${opts.to}>`)
  await smtp.wait(250)
  smtp.send('DATA')
  await smtp.wait(354)
  const body = [
    `From: ${from}`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.text,
    '',
  ].join('\r\n')
  smtp.send(body + '\r\n.')
  await smtp.wait(250)
  smtp.send('QUIT')
  smtp.end()
}
