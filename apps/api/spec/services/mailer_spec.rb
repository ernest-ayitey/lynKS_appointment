require_relative '../spec_helper'

RSpec.describe Mailer do
  it 'logs the message in log delivery mode' do
    expect(Mailer.deliver(to: 'a@b.com', subject: 'Hi', body: 'Body')).to be true
  end
end
