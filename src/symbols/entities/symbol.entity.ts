import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { History } from './history.entity';

@Entity('symbol')
export class Symbol {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, nullable: false })
  name: string;

  @Column({ type: 'timestamp', nullable: false })
  listingDate: Date;

  @Column({ type: 'float', nullable: true })
  priceOnStart: number;

  @Column({ type: 'float', nullable: true })
  priceOnMinute: number;

  @Column({ type: 'bool', default: false })
  isListed: Boolean;

  @Column({ type: 'bool', default: false })
  isFinished: Boolean;

  @OneToMany(() => History, (history) => history.symbol)
  history: History[];

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;
}
