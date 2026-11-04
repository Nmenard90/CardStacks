/**
 * FILE: ShopNotifier.scala
 * LOCATION: poketracker-v2/src/main/scala/com/poketracker/service/ShopNotifier.scala
 *
 * PURPOSE:
 *   Emails a shop owner the moment a buyer sends a request from their public shop, at the email of their CardStacks
 *   account: who it is, how they want to be contacted, the cards, the message, and a link to My Shop.
 *
 * SETUP (Railway variables on the poketracker-v2 service; emails are simply off until all three required ones are set):
 *   SMTP_HOST      e.g. smtp.gmail.com                 (required)
 *   SMTP_USER      the account that sends, e.g. you@gmail.com  (required)
 *   SMTP_PASSWORD  for Gmail an "app password", not the normal password  (required)
 *   SMTP_PORT      587 (STARTTLS, the default) or 465 (SSL)
 *   SMTP_FROM      the From address; defaults to SMTP_USER
 *   APP_URL        the site's address for the My Shop link; defaults to https://cardstacks.up.railway.app
 *
 * NEVER BREAKS A REQUEST: the route runs this in the background after the request is saved, and every failure (no
 *   setup, no email on the account, a mail server error) is only logged. At most MaxPerHour emails go to one seller
 *   per hour, so someone spamming a shop's form can't flood the owner's inbox (the requests still land in My Shop).
 *
 * USED BY: api/ShopRoutes.scala (POST /api/shop/:slug/requests), wired in Main.scala
 * DEPENDS ON: repository/ShopRepository (the seller's account email), Eclipse Angus Mail (SMTP)
 */
package com.poketracker.service

import com.poketracker.models.ShopRequest
import com.poketracker.repository.ShopRepository
import jakarta.mail.{Message, Session, Transport}
import jakarta.mail.internet.{InternetAddress, MimeMessage}
import zio.*

import java.time.Instant
import java.util.Properties

trait ShopNotifier:
  /** Tells the seller about a new request in their shop. Never fails; problems are logged. */
  def newRequest(sellerUserId: String, shopSlug: String, shopName: String, request: ShopRequest): UIO[Unit]

object ShopNotifier:

  /** Emails to one seller in any hour, at most. */
  val MaxPerHour = 20

  /** How to reach the mail server, from the environment (see SETUP above). */
  final case class SmtpConfig(host: String, port: Int, user: String, password: String, from: String, appUrl: String)

  /** One email, ready to send. `replyTo` is the buyer's address when they asked to be emailed. */
  final case class Email(to: String, subject: String, body: String, replyTo: Option[String])

  /** The settings, or None (emails off) unless SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all set. */
  def readConfig(env: String => Option[String]): Option[SmtpConfig] =
    def get(key: String) = env(key).map(_.trim).filter(_.nonEmpty)
    for
      host     <- get("SMTP_HOST")
      user     <- get("SMTP_USER")
      password <- get("SMTP_PASSWORD")
    yield SmtpConfig(
      host     = host,
      port     = get("SMTP_PORT").flatMap(_.toIntOption).getOrElse(587),
      user     = user,
      // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
      password = if host.equalsIgnoreCase("smtp.gmail.com") then password.replace(" ", "") else password,
      from     = get("SMTP_FROM").getOrElse(user),
      appUrl   = get("APP_URL").getOrElse("https://cardstacks.up.railway.app").stripSuffix("/")
    )

  /** Buyer text squeezed onto one line, for the subject (a line break there could add mail headers). */
  private def oneLine(s: String): String = s.replaceAll("[\\r\\n\\t]+", " ").trim

  /** The buyer's email when they chose "Email: …" as their contact and it is a valid address, for Reply-To. */
  private[poketracker] def buyerEmail(contact: String): Option[String] =
    val t = contact.trim
    Option.when(t.regionMatches(true, 0, "Email:", 0, 6))(t.drop(6).trim)
      .filter(a => a.length <= 200 && a.matches("[^\\s@<>,;\"]+@[^\\s@<>,;\"]+\\.[^\\s@<>,;\"]+"))

  /** The email about one request (plain text: everything in it was typed by the buyer). */
  def requestEmail(to: String, shopSlug: String, shopName: String, r: ShopRequest, appUrl: String): Email =
    val who     = oneLine(r.buyerName).take(80)
    val copies  = r.items.map(_.qty).sum
    val shop    = if shopName.trim.nonEmpty then oneLine(shopName).take(80) else shopSlug
    val subject =
      if r.items.isEmpty then s"New question from $who in your CardStacks shop"
      else s"New request from $who in your CardStacks shop ($copies card${if copies == 1 then "" else "s"})"
    val cards = r.items.map { i =>
      val photos = if i.photos.contains(true) then " · wants photos" else ""
      s"  - ${i.qty}× ${i.name} #${i.number} (${i.condition})$photos"
    }
    val lines =
      List(s"$who sent ${if r.items.isEmpty then "a question" else "a request"} in your shop \"$shop\".", "",
           s"How they want to be contacted: ${r.buyerContact.trim}") ++
      (if cards.isEmpty then Nil else "" :: "Cards:" :: cards) ++
      (if r.message.trim.isEmpty then Nil else List("", "Message:", r.message.trim)) ++
      List("", s"Open My Shop to see it and reply: $appUrl/shop/requests", "",
           "You get this email because your CardStacks shop is open. It goes to the email you sign in with.")
    Email(to, subject, lines.mkString("\n"), buyerEmail(r.buyerContact))

  /** Sends one email over SMTP (blocking, so on the blocking pool). */
  private def send(cfg: SmtpConfig, e: Email): Task[Unit] = ZIO.attemptBlocking {
    val props = new Properties()
    props.put("mail.smtp.host", cfg.host)
    props.put("mail.smtp.port", cfg.port.toString)
    props.put("mail.smtp.auth", "true")
    if cfg.port == 465 then props.put("mail.smtp.ssl.enable", "true")
    else
      props.put("mail.smtp.starttls.enable", "true")
      props.put("mail.smtp.starttls.required", "true")
    props.put("mail.smtp.connectiontimeout", "10000")
    props.put("mail.smtp.timeout", "10000")
    props.put("mail.smtp.writetimeout", "10000")
    val msg = new MimeMessage(Session.getInstance(props))
    msg.setFrom(new InternetAddress(cfg.from, "CardStacks", "UTF-8"))
    msg.setRecipients(Message.RecipientType.TO, Array[jakarta.mail.Address](new InternetAddress(e.to, true)))
    e.replyTo.foreach(r => msg.setReplyTo(Array[jakarta.mail.Address](new InternetAddress(r, true))))
    msg.setSubject(e.subject, "UTF-8")
    msg.setText(e.body, "UTF-8")
    Transport.send(msg, cfg.user, cfg.password)
  }

  private final class Live(repo: ShopRepository, cfg: Option[SmtpConfig], sent: Ref[Map[String, List[Instant]]]) extends ShopNotifier:
    def newRequest(sellerUserId: String, shopSlug: String, shopName: String, request: ShopRequest): UIO[Unit] =
      cfg match
        case None => ZIO.unit
        case Some(c) =>
          (for
            now     <- Clock.instant
            // Room for one more email to this seller this hour? (Reserve it now, so two requests can't both slip in.)
            allowed <- sent.modify { all =>
                         val recent = all.getOrElse(sellerUserId, Nil).filter(_.isAfter(now.minusSeconds(3600)))
                         if recent.size >= MaxPerHour then (false, all.updated(sellerUserId, recent))
                         else (true, all.updated(sellerUserId, now :: recent))
                       }
            to      <- if allowed then repo.sellerEmail(sellerUserId) else ZIO.none
            _       <- ZIO.foreachDiscard(to)(addr => send(c, requestEmail(addr, shopSlug, shopName, request, c.appUrl)))
          yield ()).catchAllCause(cause => ZIO.logWarningCause(s"Could not email the seller about shop request ${request.id}", cause))

  val layer: ZLayer[ShopRepository, Nothing, ShopNotifier] = ZLayer.fromZIO {
    for
      repo <- ZIO.service[ShopRepository]
      cfg  <- System.envs.map(env => readConfig(env.get)).orElseSucceed(None)
      _    <- cfg.fold(ZIO.logInfo("Shop request emails are off (set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to turn them on)."))(
                c => ZIO.logInfo(s"Shop request emails are on, sent through ${c.host}:${c.port}."))
      sent <- Ref.make(Map.empty[String, List[Instant]])
    yield Live(repo, cfg, sent)
  }
