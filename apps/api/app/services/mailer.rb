class Mailer
  def self.deliver(to:, subject:, body:)
    if ENV['MAIL_DELIVERY_METHOD'] == 'log'
      puts "To: #{to}"
      puts "Subject: #{subject}"
      puts "Body: #{body}"
      true
    else
      raise NotImplementedError, "Delivery method #{ENV['MAIL_DELIVERY_METHOD']} not yet implemented"
    end
  end
end
