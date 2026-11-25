require_relative '../spec_helper'

RSpec.describe Department do
  it 'persists with timestamps' do
    department = Department.create(name: 'Cardiology')

    expect(department.id).not_to be_nil
    expect(department.name).to eq('Cardiology')
    expect(department.created_at).not_to be_nil
    expect(department.updated_at).not_to be_nil
  end
end
