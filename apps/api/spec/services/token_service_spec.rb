require_relative '../spec_helper'

RSpec.describe TokenService do
  let(:user) do
    User.create(role: 'patient', username: 'u3', email: 'e@x.com',
                 first_name: 'A', last_name: 'B', password: 'Sup3r!word')
  end

  it 'issues a decodable access token carrying sub and role' do
    jwt = TokenService.issue_access_token(user)
    claims = TokenService.decode_access_token(jwt)
    expect(claims['sub']).to eq(user.id)
    expect(claims['role']).to eq('patient')
  end

  it 'rotates a refresh token and rejects the old one on reuse' do
    raw = TokenService.issue_refresh_token(user, remember_me: false)
    new_raw, rotated_user = TokenService.rotate_refresh_token(raw)
    expect(rotated_user.id).to eq(user.id)
    expect(TokenService.rotate_refresh_token(raw)).to be_nil
    expect(TokenService.rotate_refresh_token(new_raw)).not_to be_nil
  end

  it 'rejects an expired or revoked refresh token' do
    raw = TokenService.issue_refresh_token(user, remember_me: false)
    TokenService.revoke_refresh_token(raw)
    expect(TokenService.rotate_refresh_token(raw)).to be_nil
  end

  it 'preserves remember_me across rotation' do
    raw = TokenService.issue_refresh_token(user, remember_me: true)
    new_raw, = TokenService.rotate_refresh_token(raw)
    new_token = RefreshToken.first(token_hash: RefreshToken.hash_token(new_raw))
    expect(new_token.remember_me).to be true
  end
end
