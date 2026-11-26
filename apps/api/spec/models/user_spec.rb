require_relative '../spec_helper'

RSpec.describe User do
  it 'hashes the password and authenticates it' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'Ernest', last_name: 'A', password: 'Sup3r!word')
    expect(user.password_digest).not_to eq('Sup3r!word')
    expect(user.authenticate('Sup3r!word')).to be true
    expect(user.authenticate('wrong')).to be false
  end

  it 'finds a user by username case-insensitively' do
    User.create(role: 'patient', username: 'Ernesta', email: 'e@x.com',
      first_name: 'Ernest', last_name: 'A', password: 'Sup3r!word')
    expect(User.find_by_username_ci('ernesta')).not_to be_nil
  end

  it 'treats locked and deactivated as sign-in blocked, but not invited' do
    user = User.create(role: 'patient', username: 'statuses', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')

    expect(user.signin_blocked?).to be false

    user.update(status: 'invited')
    expect(user.signin_blocked?).to be false

    user.update(status: 'locked')
    expect(user.signin_blocked?).to be true
    expect(user.locked?).to be true
    expect(user.deactivated?).to be false

    user.update(status: 'deactivated')
    expect(user.signin_blocked?).to be true
    expect(user.deactivated?).to be true
    expect(user.locked?).to be false
  end

  describe '.active_doctors' do
    it 'includes only active doctors, excluding other roles and non-active statuses' do
      active = User.create(role: 'doctor', username: 'docA', email: 'a@x.com',
        first_name: 'A', last_name: 'B', password: 'Sup3r!word')
      User.create(role: 'doctor', username: 'docL', email: 'l@x.com',
        first_name: 'L', last_name: 'B', password: 'Sup3r!word', status: 'locked')
      User.create(role: 'doctor', username: 'docD', email: 'd@x.com',
        first_name: 'D', last_name: 'B', password: 'Sup3r!word', status: 'deactivated')
      User.create(role: 'doctor', username: 'docI', email: 'i@x.com',
        first_name: 'I', last_name: 'B', password: 'Sup3r!word', status: 'invited')
      User.create(role: 'patient', username: 'pat', email: 'p@x.com',
        first_name: 'P', last_name: 'B', password: 'Sup3r!word')

      expect(User.active_doctors.select_map(:id)).to eq([active.id])
    end
  end
end
